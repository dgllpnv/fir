-- ===========================================================================
-- G8, TICKET 3D — BIBLIOTECA GERAL NO PORTAL, O ESPAÇO DA CLIENTE E A REGRA
-- DO BENEFÍCIO DE INDICAÇÃO.
--
-- Inventário `docs/specs/g8-paridade-gestao-inventario.md`: X2 (biblioteca
-- geral), O2, O4, O5, O8, V7, O9, O10, T5, L12. Gates: `g8-gate-appsec.md`
-- A-7, A-18, A-19; `g8-gate-lgpd.md` A52; `g8-gate-numeros.md` ajuste 9.
--
-- Forward-only, EXPAND: colunas novas com default, funções novas, policies
-- novas ou mais estreitas, GRANTs de COLUNA. A única policy afrouxada é a de
-- `metas_comerciais` para o portal (parte 4), e o afrouxamento é o que a 0052
-- deixou escrito: o `prazo IS NOT NULL` só existia enquanto a tela do portal
-- não sabia desenhar meta sem prazo. Nenhuma migration aplicada é editada.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- PARTE 1 — `materiais_da_biblioteca`: a escrita ganha `carteira.administrar`
-- por AND (A-18/A-19). A 0048 deixou o ponto marcado ("quando existir, a
-- policy de escrita ganha a condição por AND"); a 0056 fez isso nas outras
-- tabelas globais e esta ficou de fora.
-- ---------------------------------------------------------------------------
ALTER POLICY materiais_da_biblioteca_criacao ON materiais_da_biblioteca
  WITH CHECK (app_escopo() = 'geral' AND app_carteira_pode_administrar());
ALTER POLICY materiais_da_biblioteca_edicao ON materiais_da_biblioteca
  USING (app_escopo() = 'geral' AND app_carteira_pode_administrar())
  WITH CHECK (app_escopo() = 'geral' AND app_carteira_pode_administrar());


-- ---------------------------------------------------------------------------
-- PARTE 2 — O PORTAL LÊ A BIBLIOTECA GERAL (O5, `fg-portal.js` L131–136):
-- só o material que pode ir para a cliente (`NOT uso_interno`), não
-- arquivado, e de um programa de algum cliente que a sessão do portal vê.
--
-- `app_portal_programa_do_cliente` é o `programaDoCliente` do domínio
-- (`packages/domain/src/conteudo-carteira.ts`, protótipo `programaPadrao`
-- L2205 e `programaDe` portal:L9) — a regra escrita duas vezes, e por isso
-- `teste/biblioteca-no-portal.test.ts` compara as duas sobre toda área de
-- foco do cadastro. Existe no banco porque a policy precisa dela: o gate
-- (A-18) pede a decisão do portal DENTRO da função, nunca na aplicação só.
--
-- `app_portal_pode_ver_material` usa `CASE` e é SECURITY INVOKER: a leitura
-- de `clientes_carteira` dentro dela passa pela RLS de `fir_portal`, então
-- "algum cliente visível" é exatamente o que `app_portal_pode_ver` deixa ver
-- — escopo cliente, só o próprio; escopo grupo, os do grupo. Nenhum cliente
-- de outro grupo entra na decisão. A aplicação filtra de novo, por cliente
-- (`materiaisParaOCliente`): numa sessão de grupo, o material do programa da
-- clínica A não aparece na seção da clínica B.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_portal_programa_do_cliente(p_area_foco text, p_produto text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
    SELECT CASE
      WHEN p_area_foco = 'Gestão' OR strpos(coalesce(p_produto, ''), 'Gestão FIR') > 0 THEN 'Gestão'
      WHEN p_area_foco IN ('Comercial', 'Financeiro', 'Operações') THEN p_area_foco
      WHEN p_area_foco IN ('Processos', 'Pessoas') THEN 'Operações'
      ELSE 'Comercial'
    END
  $$;

COMMENT ON FUNCTION app_portal_programa_do_cliente(text, text) IS
  'G8 3D: o programa do Método de um Cliente Firmare — espelho de '
  'programaDoCliente (packages/domain). teste/biblioteca-no-portal.test.ts '
  'confere que as duas dizem o mesmo.';

CREATE FUNCTION app_portal_pode_ver_material(p_programas text[]) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT coalesce(
      CASE
        WHEN 'Todos' = ANY (p_programas) THEN EXISTS (
          SELECT 1 FROM clientes_carteira c
           WHERE c.excluido_em IS NULL
             AND app_portal_pode_ver(c.grupo_id, c.id))
        ELSE EXISTS (
          SELECT 1 FROM clientes_carteira c
           WHERE c.excluido_em IS NULL
             AND app_portal_pode_ver(c.grupo_id, c.id)
             AND app_portal_programa_do_cliente(c.area_foco, c.produto) = ANY (p_programas))
      END,
      false)
  $$;

COMMENT ON FUNCTION app_portal_pode_ver_material(text[]) IS
  'G8 3D (A-18): algum cliente que a sessão do portal vê tem um destes '
  'programas (ou o material é de "Todos")? CASE, sem OR; SECURITY INVOKER — '
  'clientes_carteira passa pela RLS de fir_portal, e app_portal_pode_ver é '
  'repetido aqui como segunda camada.';

REVOKE ALL ON FUNCTION app_portal_programa_do_cliente(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_portal_pode_ver_material(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_portal_programa_do_cliente(text, text) TO fir_portal, fir_carteira;
GRANT EXECUTE ON FUNCTION app_portal_pode_ver_material(text[]) TO fir_portal;

-- `NOT uso_interno` e `arquivado_em IS NULL` por AND, no texto da policy
-- (A-7, A-18). `TO fir_portal` explícito (lição da 0035).
CREATE POLICY materiais_da_biblioteca_portal ON materiais_da_biblioteca
  FOR SELECT TO fir_portal
  USING (NOT uso_interno AND arquivado_em IS NULL AND app_portal_pode_ver_material(programas));

-- SELECT só nas colunas que o portal mostra (A-18, critério 11 da ADR 0018
-- estendido). `criado_por` (quem da Firmare cadastrou), `criado_em` e
-- `atualizado_em` ficam de fora. Nenhum verbo de escrita.
GRANT SELECT (id, titulo, tipo, programas, uso_interno, link, texto, descricao, arquivado_em)
  ON materiais_da_biblioteca TO fir_portal;


-- ---------------------------------------------------------------------------
-- PARTE 3 — O CABEÇALHO, O CICLO E A CONSULTORA (O2, O8; `fg-portal.js`
-- L101–113, L153–160).
--
-- A 0047 trocou o SELECT de tabela do portal em `clientes_carteira` por
-- privilégio de COLUNA e deixou escrito: "coluna nova que o portal precisar
-- entra por GRANT próprio, no ticket que a mostra". São estas:
--  * `decisor` — "Olá, [primeiro nome da decisora]": é a própria cliente;
--  * `data_inicio`, `data_fim` — "Mês N de M" / "Nº mês juntos";
--  * `area_foco` — o programa (materiais e cartão do ciclo);
--  * `reuniao_dia_semana`, `reuniao_hora` — "Reunião fixa" no cartão da
--    consultora, e a semana da reunião na avaliação das metas (O4);
--  * `responsavel_usuario_gestao_id` — só para a função abaixo achar o nome.
-- Observações, pagador, telefone de cobrança, CNPJ, aniversário e o resto do
-- cadastro interno continuam fora (A-7, LGPD A33).
-- ---------------------------------------------------------------------------
GRANT SELECT (decisor, data_inicio, data_fim, area_foco, reuniao_dia_semana, reuniao_hora,
              responsavel_usuario_gestao_id)
  ON clientes_carteira TO fir_portal;

-- O NOME da consultora, e só o nome (appsec A-18, LGPD O8: nunca telefone,
-- e-mail nem nascimento da colaboradora). `usuarios_gestao` não tem RLS, e
-- dar a `fir_portal` SELECT em `(id, nome)` deixaria o portal listar a equipe
-- inteira. A função devolve um nome por id, de um usuário ATIVO; o id só
-- chega ao portal pela coluna `responsavel_usuario_gestao_id` de um cliente
-- que a RLS dele deixou ler. SECURITY DEFINER porque é a única leitura de
-- `usuarios_gestao` que o portal faz, e ela é por coluna (nome) e por linha.
CREATE FUNCTION app_portal_nome_da_consultora(p_usuario_gestao uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT u.nome FROM usuarios_gestao u WHERE u.id = p_usuario_gestao AND u.ativo
  $$;

COMMENT ON FUNCTION app_portal_nome_da_consultora(uuid) IS
  'G8 3D (O8): só o nome da Responsável Firmare ativa — nunca telefone, '
  'e-mail nem nascimento. SECURITY DEFINER, uma coluna, uma linha.';

REVOKE ALL ON FUNCTION app_portal_nome_da_consultora(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_portal_nome_da_consultora(uuid) TO fir_portal;


-- ---------------------------------------------------------------------------
-- PARTE 4 — AS METAS NO PORTAL PELA MESMA AVALIAÇÃO DA CARTEIRA (O4, CE-2).
--
-- `leitura-do-portal.service.ts` passa a usar `SELECT_META`,
-- `carregarContexto` e `avaliarMetas` (`metas-avaliacao.ts`): a meta sem
-- prazo (mensal) agora tem desenho, e a 0052 pedia exatamente isto — sair o
-- `prazo IS NOT NULL` quando a O4 fosse ligada. A cancelada continua fora.
-- ---------------------------------------------------------------------------
ALTER POLICY metas_comerciais_portal ON metas_comerciais
  TO fir_portal
  USING (app_portal_pode_ver(grupo_id, cliente_carteira_id) AND status <> 'cancelada');

-- `SELECT_META` conta as ações do plano da meta. O portal não mostra ação do
-- plano nenhuma: as três colunas da contagem ganham SELECT, e NENHUMA policy
-- para `fir_portal` é criada — com RLS forçada, a contagem dá zero para ele.
-- Privilégio sem linha: o SELECT compila, e nada da tabela atravessa.
GRANT SELECT (meta_comercial_id, arquivada_em, status) ON acoes_do_plano TO fir_portal;

-- A meta com fonte na planilha do Google (4A) é avaliada pelo `resultado`
-- interpretado (só números e carimbos, nunca texto livre — 0045). O link da
-- planilha, o id dela no Google e o erro da leitura ficam de fora.
CREATE POLICY planilhas_do_cliente_portal ON planilhas_do_cliente
  FOR SELECT TO fir_portal
  USING (app_portal_pode_ver(grupo_id, cliente_carteira_id));

GRANT SELECT (cliente_carteira_id, grupo_id, resultado) ON planilhas_do_cliente TO fir_portal;


-- ---------------------------------------------------------------------------
-- PARTE 5 — VÁRIAS CONTAS POR CLIENTE NO PORTAL (V7, O10; LGPD A52).
--
-- A dispensa de redação de valores no portal (ADR 0017 §3) valia "enquanto o
-- leitor for o titular da cobrança". A lista de acessos da cliente (V7) faz
-- de várias contas por cliente uma funcionalidade de tela — o gatilho
-- disparou. A saída recomendada pelo gate é a coluna: quem não é o titular
-- não vê cobrança nem receita.
--
-- Linhas existentes: `true`. Elas foram criadas sob a premissa da ADR 0017
-- §3 (uma conta, a do titular) e tirar o valor delas no deploy mudaria o que
-- a cliente já vê sem ninguém ter decidido. Conta NOVA nasce `false` pelo
-- default; o serviço decide `true` só para a PRIMEIRA conta ativa do cliente
-- (o titular) e para a de grupo, que o Operador cria para o dono da rede.
-- ---------------------------------------------------------------------------
ALTER TABLE usuarios_do_portal ADD COLUMN ve_valores boolean;
UPDATE usuarios_do_portal SET ve_valores = true;
ALTER TABLE usuarios_do_portal
  ALTER COLUMN ve_valores SET DEFAULT false,
  ALTER COLUMN ve_valores SET NOT NULL;

COMMENT ON COLUMN usuarios_do_portal.ve_valores IS
  'LGPD A52: esta conta vê cobranças e receita do cliente. A primeira conta '
  'ativa (o titular) e a de grupo nascem true; as demais, false. Sem ela, o '
  'RedacaoInterceptor apaga os campos monetários da resposta do portal.';


-- ---------------------------------------------------------------------------
-- PARTE 6 — A REGRA DO BENEFÍCIO DE INDICAÇÃO (T5, L12; ajuste 9).
--
-- "Alterar regra" (L2542, L2656, `editBenef` L2956). Num lugar só: a
-- conversão do lead FOTOGRAFA este valor em
-- `beneficios_de_indicacao.percentual_centesimos` na mesma transação, e a
-- mensagem `{beneficio}` lê o mesmo valor — `beneficios.regra.ts` é a única
-- leitura. Mudar a regra não mexe em benefício já gerado.
--
-- Centésimos de ponto percentual, nunca texto (ADR 0015 achado 5): `1000` =
-- 10,00%, o "10% de desconto na mensalidade seguinte" de fábrica do protótipo
-- (L1047). Teto 10000 (100%): o gerador de cobranças já trata o desconto
-- total (ajuste 8). Escrita: a policy de edição da 0056 já exige escopo
-- geral e `carteira.administrar`; o UPDATE de tabela de `fir_carteira`
-- alcança a coluna nova, e a trilha é o trigger da 0054.
-- ---------------------------------------------------------------------------
ALTER TABLE configuracao_da_carteira
  ADD COLUMN beneficio_percentual_centesimos bigint NOT NULL DEFAULT 1000
    CHECK (beneficio_percentual_centesimos BETWEEN 1 AND 10000);

COMMENT ON COLUMN configuracao_da_carteira.beneficio_percentual_centesimos IS
  'A regra vigente do benefício de indicação, em centésimos de ponto '
  'percentual (1000 = 10%). Fotografada na conversão do lead (ajuste 9); a '
  'mensagem {beneficio} lê a mesma coluna.';
