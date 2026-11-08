-- ===========================================================================
-- G8, TICKET 4C — ANEXOS DE ARQUIVO da carteira (reunião e documento).
--
-- Inventário `docs/specs/g8-paridade-gestao-inventario.md` (V14, O7);
-- decisão D-22 item 6 (arquivos na VPS); gate de segurança
-- `g8-gate-appsec.md` A-13; gate LGPD `g8-gate-lgpd.md`.
--
-- O que mora aqui é só o METADADO. O arquivo vive num volume dedicado
-- (`/dados/anexos`), cifrado por arquivo (AES-256-GCM, chave em
-- `CHAVE_ANEXOS`, nunca no banco), com nome = `chave_armazenamento` — um UUID
-- aleatório, nunca o nome que o usuário deu. Ver
-- `apps/api/src/carteira/anexos/armazenamento-de-anexos.ts`.
--
-- Forward-only, expand: tabela nova, função nova, um índice único novo em
-- `clientes_carteira`. Nenhuma migration aplicada é editada.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- A-8: o `grupo_id` do filho não diverge do pai. A FK composta
-- `(cliente_carteira_id, grupo_id) → clientes_carteira(id, grupo_id)` exige
-- um índice único no par. `id` já é chave primária, então o par é único por
-- construção — o índice só existe para a FK poder apontar para ele.
-- `IF NOT EXISTS`: outra migration da Onda 1 pode criar o mesmo par para as
-- tabelas antigas (dívida registrada em A-8); a segunda vira no-op.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS clientes_carteira_id_grupo_unico
  ON clientes_carteira (id, grupo_id);


-- ---------------------------------------------------------------------------
-- `anexos_carteira`
-- ---------------------------------------------------------------------------
CREATE TABLE anexos_carteira (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id            uuid NOT NULL REFERENCES grupos(id),
  cliente_carteira_id uuid NOT NULL,
  -- O dono é polimórfico (reunião OU documento). Não há FK possível para
  -- duas tabelas; a existência do dono, no MESMO cliente e no MESMO grupo, é
  -- conferida pelo trigger `anexos_carteira_confere_dono` no INSERT.
  dono_tipo           text NOT NULL CHECK (dono_tipo IN ('reuniao', 'documento')),
  dono_id             uuid NOT NULL,
  -- Só para EXIBIÇÃO e para o `filename*` do download. Já chega aqui
  -- sanitizado (sem caminho, sem caractere de controle, até 200 caracteres).
  -- Nunca vira nome de arquivo no disco.
  nome_original       text NOT NULL CHECK (length(nome_original) BETWEEN 1 AND 200),
  -- O tipo DETECTADO pelos bytes (`tipo-pelos-bytes.ts`), nunca o
  -- `Content-Type` nem a extensão que o cliente mandou. A lista é a lista de
  -- permissão inteira: um tipo fora dela não tem como ser gravado.
  tipo_mime           text NOT NULL CHECK (tipo_mime IN (
                        'application/pdf',
                        'image/png',
                        'image/jpeg',
                        'image/webp',
                        'image/gif',
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                        'text/plain',
                        'text/csv',
                        'text/markdown',
                        'video/mp4',
                        'video/webm')),
  -- Bytes do arquivo ORIGINAL (não do cifrado). 20 MB é o teto do A-13,
  -- aplicado também aqui: uma linha acima do teto não nasce nem por engano.
  tamanho             bigint NOT NULL CHECK (tamanho BETWEEN 1 AND 20971520),
  sha256              text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  chave_armazenamento uuid NOT NULL UNIQUE,
  -- Falha FECHADA: nasce `pendente`, e só `limpo` é servido — à equipe e ao
  -- portal. `infectado` mantém a linha (trilha) e o arquivo é apagado.
  situacao_varredura  text NOT NULL DEFAULT 'pendente'
                        CHECK (situacao_varredura IN ('pendente', 'limpo', 'infectado')),
  criado_por          uuid NOT NULL REFERENCES usuarios_gestao(id),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  -- Remover é estado (regra 20). O expurgo físico do arquivo segue a linha
  -- de retenção do DONO (reunião: vigência + 5 anos, `retencao.md`), por job
  -- próprio — nunca por esta coluna.
  removido_em         timestamptz,

  CONSTRAINT anexos_carteira_cliente_do_grupo
    FOREIGN KEY (cliente_carteira_id, grupo_id)
    REFERENCES clientes_carteira (id, grupo_id)
    -- Mover um cliente de grupo (A-10 item 6, só o Operador) leva os anexos
    -- junto, na mesma instrução — sem isto a FK recusaria a mudança.
    ON UPDATE CASCADE
);

COMMENT ON TABLE anexos_carteira IS
  'Anexo de arquivo de uma reunião comercial ou de um documento da carteira '
  '(G8 4C, A-13). Só o metadado: o arquivo vive cifrado no volume de anexos, '
  'com nome = chave_armazenamento. tipo_mime é o tipo detectado pelos BYTES. '
  'Só situacao_varredura = limpo é servido, à equipe e ao portal; o portal '
  'ainda exige o dono compartilhado (reunião compartilhada e não arquivada, '
  'documento visivel_portal).';
COMMENT ON COLUMN anexos_carteira.nome_original IS
  'Nome dado pelo usuário, sanitizado, só para exibição e Content-Disposition. '
  'Pode conter dado pessoal: nunca vai para log (A-21).';
COMMENT ON COLUMN anexos_carteira.chave_armazenamento IS
  'UUID aleatório que é o nome do arquivo cifrado no volume, e o AAD da cifra '
  '(um arquivo copiado para outra chave não decifra). Nunca o nome do usuário.';

CREATE INDEX anexos_carteira_por_dono ON anexos_carteira (dono_tipo, dono_id)
  WHERE removido_em IS NULL;
CREATE INDEX anexos_carteira_pendentes ON anexos_carteira (criado_em)
  WHERE situacao_varredura = 'pendente';
CREATE INDEX anexos_carteira_por_grupo ON anexos_carteira (grupo_id)
  WHERE removido_em IS NULL;

-- A-20: duplo clique e retry de rede não criam dois anexos iguais no mesmo
-- dono. O serviço devolve o existente (`ON CONFLICT DO NOTHING` + releitura).
-- Parcial: depois de remover, enviar de novo o mesmo arquivo é um anexo novo.
CREATE UNIQUE INDEX anexos_carteira_sem_duplicata
  ON anexos_carteira (dono_tipo, dono_id, sha256)
  WHERE removido_em IS NULL;


-- ---------------------------------------------------------------------------
-- O dono existe, no MESMO cliente e no MESMO grupo — o papel da FK que não
-- pode existir (dono polimórfico). SECURITY INVOKER de propósito: a consulta
-- passa pela RLS de quem insere, então um Usuário de Gestão do grupo A não
-- consegue pendurar anexo numa reunião do grupo B nem sabendo o id dela.
-- ---------------------------------------------------------------------------
CREATE FUNCTION anexos_carteira_confere_dono() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.dono_tipo = 'reuniao' THEN
    PERFORM 1 FROM reunioes_comerciais
      WHERE id = NEW.dono_id
        AND cliente_carteira_id = NEW.cliente_carteira_id
        AND grupo_id = NEW.grupo_id;
  ELSE
    PERFORM 1 FROM documentos_carteira
      WHERE id = NEW.dono_id
        AND cliente_carteira_id = NEW.cliente_carteira_id
        AND grupo_id = NEW.grupo_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'anexos_carteira: dono % % não existe neste cliente e grupo',
      NEW.dono_tipo, NEW.dono_id USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER anexos_carteira_confere_dono
  BEFORE INSERT ON anexos_carteira
  FOR EACH ROW EXECUTE FUNCTION anexos_carteira_confere_dono();


-- ---------------------------------------------------------------------------
-- O que pode mudar numa linha, e quem muda.
--
-- `fir_carteira` é o papel da sessão do Usuário de Gestão E do worker de
-- varredura (mesma conexão, ADR 0012). Privilégio de coluna sozinho não
-- separa os dois, então o trigger separa:
--   * `situacao_varredura` só anda `pendente → limpo|infectado`, uma vez, e
--     só com ator `sistema` (o worker). Um Usuário de Gestão — ou uma injeção
--     na sessão dele — não marca `infectado` como `limpo`;
--   * `removido_em` só sai de NULL para um instante, uma vez (remover é
--     estado, não se "desremove" por UPDATE);
--   * o resto é imutável. `grupo_id` fica de fora só porque o ON UPDATE
--     CASCADE da FK composta precisa movê-lo junto com o cliente.
-- ---------------------------------------------------------------------------
CREATE FUNCTION anexos_carteira_transicao() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_ator text := coalesce(current_setting('app.pessoa_id', true), '');
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.cliente_carteira_id IS DISTINCT FROM OLD.cliente_carteira_id
     OR NEW.dono_tipo IS DISTINCT FROM OLD.dono_tipo
     OR NEW.dono_id IS DISTINCT FROM OLD.dono_id
     OR NEW.nome_original IS DISTINCT FROM OLD.nome_original
     OR NEW.tipo_mime IS DISTINCT FROM OLD.tipo_mime
     OR NEW.tamanho IS DISTINCT FROM OLD.tamanho
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.chave_armazenamento IS DISTINCT FROM OLD.chave_armazenamento
     OR NEW.criado_por IS DISTINCT FROM OLD.criado_por
     OR NEW.criado_em IS DISTINCT FROM OLD.criado_em THEN
    RAISE EXCEPTION 'anexos_carteira: coluna imutável alterada' USING ERRCODE = '42501';
  END IF;

  IF NEW.situacao_varredura IS DISTINCT FROM OLD.situacao_varredura THEN
    IF OLD.situacao_varredura <> 'pendente' THEN
      RAISE EXCEPTION 'anexos_carteira: a varredura já terminou' USING ERRCODE = '42501';
    END IF;
    IF v_ator <> 'sistema' THEN
      RAISE EXCEPTION 'anexos_carteira: só o worker de varredura muda a situação'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.removido_em IS DISTINCT FROM OLD.removido_em AND OLD.removido_em IS NOT NULL THEN
    RAISE EXCEPTION 'anexos_carteira: anexo já removido' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER anexos_carteira_transicao
  BEFORE UPDATE ON anexos_carteira
  FOR EACH ROW EXECUTE FUNCTION anexos_carteira_transicao();

-- A trilha de escrita (regra 20): criar, remover e o resultado da varredura.
-- Tabela sem `clinica_id`: vai para `auditoria_do_painel`, como as de G5.
CREATE TRIGGER anexos_carteira_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON anexos_carteira
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria_do_painel();


-- ---------------------------------------------------------------------------
-- O portal vê o anexo só se o DONO estiver compartilhado.
--
-- `CASE`, nunca `OR` na policy (ADR 0018 §1, A-18). SECURITY INVOKER: as
-- duas consultas passam pela RLS de `fir_portal` nas tabelas do dono — a de
-- `reunioes_comerciais` já exige `compartilhada AND arquivada_em IS NULL`
-- (0042), a de `documentos_carteira` já exige `visivel_portal` (0034). As
-- condições são repetidas aqui de propósito: é a segunda camada, e ela é o
-- que continua valendo se uma das policies do dono for afrouxada um dia.
-- Descompartilhar a reunião tira o anexo na próxima requisição (A-13).
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_portal_pode_ver_dono_de_anexo(p_tipo text, p_dono uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT coalesce(
      CASE p_tipo
        WHEN 'reuniao' THEN EXISTS (
          SELECT 1 FROM reunioes_comerciais r
           WHERE r.id = p_dono AND r.compartilhada AND r.arquivada_em IS NULL)
        WHEN 'documento' THEN EXISTS (
          SELECT 1 FROM documentos_carteira d
           WHERE d.id = p_dono AND d.visivel_portal)
        ELSE false
      END,
      false)
  $$;

COMMENT ON FUNCTION app_portal_pode_ver_dono_de_anexo(text, uuid) IS
  'O dono do anexo está visível ao portal: reunião compartilhada e não '
  'arquivada, ou documento visivel_portal. CASE, sem OR (ADR 0018 §1). '
  'Chamada pela policy anexos_carteira_portal.';

REVOKE ALL ON FUNCTION app_portal_pode_ver_dono_de_anexo(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_portal_pode_ver_dono_de_anexo(text, uuid) TO fir_portal;


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE anexos_carteira ENABLE ROW LEVEL SECURITY;
ALTER TABLE anexos_carteira FORCE  ROW LEVEL SECURITY;

-- `TO` explícito nas duas: policy sem `TO` vale para PUBLIC e se soma por OR
-- à do outro papel (a lição da 0035).
CREATE POLICY anexos_carteira_carteira ON anexos_carteira
  TO fir_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

CREATE POLICY anexos_carteira_portal ON anexos_carteira
  FOR SELECT TO fir_portal
  USING (situacao_varredura = 'limpo'
         AND removido_em IS NULL
         AND app_portal_pode_ver(grupo_id, cliente_carteira_id)
         AND app_portal_pode_ver_dono_de_anexo(dono_tipo, dono_id));


-- ---------------------------------------------------------------------------
-- PRIVILÉGIOS
-- ---------------------------------------------------------------------------
REVOKE ALL ON anexos_carteira FROM fir_app;
REVOKE ALL ON anexos_carteira FROM PUBLIC;

-- Sem DELETE: remover é `removido_em`. UPDATE só nas duas colunas que o
-- trigger acima permite mudar (mais `grupo_id`, que só o CASCADE move — e o
-- CASCADE roda com o privilégio do dono da tabela, não precisa de GRANT).
GRANT SELECT, INSERT ON anexos_carteira TO fir_carteira;
GRANT UPDATE (situacao_varredura, removido_em) ON anexos_carteira TO fir_carteira;

-- O portal: SELECT só nas colunas que a leitura usa, nenhum verbo de escrita
-- (ADR 0018 critério 11, estendido pelo A-18). `criado_por` (quem da Firmare
-- enviou) e `sha256` ficam de fora. Coluna nova não herda SELECT do portal.
GRANT SELECT (id, grupo_id, cliente_carteira_id, dono_tipo, dono_id, nome_original,
              tipo_mime, tamanho, chave_armazenamento, situacao_varredura,
              criado_em, removido_em)
  ON anexos_carteira TO fir_portal;
