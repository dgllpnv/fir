@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

REM ---------------------------------------------------------------------------
REM  Firmare Rotinas de Gestao - ambiente local
REM
REM    fir            sobe TUDO e deixa a aplicacao rodando com os logs a vista
REM    fir infra      so os containers (banco, Redis, Mailpit) - para os testes
REM    fir down       derruba, preservando os dados
REM    fir reset      derruba e APAGA os volumes (banco zerado)
REM    fir status     estado dos servicos
REM    fir logs       logs dos containers
REM    fir psql       shell psql no banco local
REM
REM  Portas: bloco 48xx. 47xx e do Mavia, que roda na mesma maquina.
REM  A janela NAO fecha sozinha no duplo clique: todo caminho passa por :fim.
REM ---------------------------------------------------------------------------

set "DUPLO=0"
echo(%cmdcmdline%| findstr /i /c:"%~nx0" >nul && set "DUPLO=1"

set "RAIZ=%~dp0"
set "COMPOSE=%RAIZ%infra\docker-compose.yml"
set "PORTA_PG=4832"
set "PORTA_REDIS=4879"
set "PORTA_API=4811"
set "PORTA_WEB=4810"
set "PORTA_MAILPIT=4825"
set "PORTA_SMTP=4826"
set "CODIGO=0"

set "ACAO=%~1"
if "%ACAO%"=="" set "ACAO=up"

docker info >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [ERRO] O Docker nao esta respondendo.
  echo   Abra o Docker Desktop, espere ele iniciar, e rode este script de novo.
  echo.
  set "CODIGO=1"
  goto :fim
)

if /i "%ACAO%"=="up"     goto :subir
if /i "%ACAO%"=="infra"  goto :infra
if /i "%ACAO%"=="down"   goto :derrubar
if /i "%ACAO%"=="reset"  goto :resetar
if /i "%ACAO%"=="status" goto :status
if /i "%ACAO%"=="logs"   goto :logs
if /i "%ACAO%"=="psql"   goto :psql

echo.
echo   Comando desconhecido: %ACAO%
echo   Use: fir [up^|infra^|down^|reset^|status^|logs^|psql]
echo.
set "CODIGO=1"
goto :fim

REM ---------------------------------------------------------------------------
:subir
REM Recusa em vez de fingir: sem node_modules, "pnpm --silent db:migrate"
REM falha mais abaixo com um erro opaco do pnpm (ERR_PNPM_...) que nao diz
REM o que fazer. Falha aqui, antes de subir os containers, com instrucao.
if not exist "%RAIZ%node_modules\" (
  echo.
  echo   [ERRO] As dependencias nao estao instaladas.
  echo   Rode "pnpm install" na raiz do projeto e tente de novo.
  echo   Isso e necessario uma vez, depois de clonar.
  echo.
  set "CODIGO=1"
  goto :fim
)

call :containers
if errorlevel 1 goto :fim

echo.
echo   Aplicando migrations...
call pnpm --silent db:migrate
if errorlevel 1 (
  echo.
  echo   [ERRO] As migrations falharam. Nada foi iniciado.
  echo   Rode "fir logs" para ver o banco.
  set "CODIGO=1"
  goto :fim
)

echo.
echo   Semeando a clinica de demonstracao...
call pnpm --silent db:seed
if errorlevel 1 (
  echo.
  echo   [ERRO] A semente falhou.
  set "CODIGO=1"
  goto :fim
)

call :painel

set "SMTP_HOST=127.0.0.1"
set "SMTP_PORTA=%PORTA_SMTP%"
set "SMTP_REMETENTE=Firmare <ola@firmare.local>"
set "FIR_URL_PUBLICA=http://127.0.0.1:%PORTA_WEB%"

echo   Subindo API e web. Os logs dos dois aparecem abaixo.
echo   Ctrl+C encerra os dois e devolve o prompt.
echo.

call pnpm exec turbo run dev --filter=@fir/api --filter=@fir/web

echo.
echo   Aplicacao encerrada. Os containers continuam no ar.
echo   Use "fir down" para derruba-los.
goto :fim

REM ---------------------------------------------------------------------------
:infra
call :containers
if errorlevel 1 goto :fim
call :painel
echo   So os containers, como pedido. A aplicacao nao foi iniciada.
echo.
goto :fim

REM ---------------------------------------------------------------------------
:containers
echo.
echo   Subindo os containers do Firmare...
echo.
docker compose -f "%COMPOSE%" up -d
if errorlevel 1 (
  echo.
  echo   [ERRO] Falha ao subir os containers.
  set "CODIGO=1"
  exit /b 1
)

echo.
echo   Esperando o Postgres aceitar conexao...
set /a TENTATIVA=0
:esperar_pg
set /a TENTATIVA+=1
docker exec fir-postgres pg_isready -U fir -d fir >nul 2>&1
if not errorlevel 1 goto :pg_pronto
if !TENTATIVA! geq 40 (
  echo.
  echo   [ERRO] O Postgres nao ficou pronto em 40 tentativas.
  echo   Rode "fir logs" para ver o que aconteceu.
  set "CODIGO=1"
  exit /b 1
)
REM ping em vez de timeout: timeout falha quando a saida esta redirecionada.
ping -n 2 127.0.0.1 >nul
goto :esperar_pg

:pg_pronto
set /a TENTATIVA=0
:esperar_redis
set /a TENTATIVA+=1
docker exec fir-redis redis-cli ping >nul 2>&1
if not errorlevel 1 goto :redis_pronto
if !TENTATIVA! geq 40 (
  echo   [ERRO] O Redis nao ficou pronto.
  set "CODIGO=1"
  exit /b 1
)
ping -n 2 127.0.0.1 >nul
goto :esperar_redis

:redis_pronto
exit /b 0

REM ---------------------------------------------------------------------------
:painel
echo.
echo   ------------------------------------------------------------------
echo    Ambiente no ar
echo   ------------------------------------------------------------------
echo.
echo    Aplicacao   http://127.0.0.1:%PORTA_WEB%
echo    API         http://127.0.0.1:%PORTA_API%
echo    Mailpit     http://127.0.0.1:%PORTA_MAILPIT%   (a caixa de entrada local)
echo    Postgres    127.0.0.1:%PORTA_PG%    usuario: fir   senha: fir_local_dev
echo    Redis       127.0.0.1:%PORTA_REDIS%
echo.
echo    Entre com:  demo@firmare.local
echo    Senha:      firmare-demonstracao
echo.
echo    Credenciais valem SO neste ambiente local. Nunca reutilize.
echo.
echo    fir psql    abre o banco       fir logs     logs dos containers
echo    fir down    derruba            fir reset    zera o banco
echo   ------------------------------------------------------------------
echo.
exit /b 0

REM ---------------------------------------------------------------------------
:derrubar
echo.
echo   Derrubando os containers. Os dados sao preservados.
docker compose -f "%COMPOSE%" down
echo.
goto :fim

REM ---------------------------------------------------------------------------
:resetar
echo.
echo   Isto APAGA o banco local e todos os dados dele.
set /p "CONFIRMA=  Digite ZERAR para confirmar: "
if /i not "%CONFIRMA%"=="ZERAR" (
  echo.
  echo   Cancelado. Nada foi apagado.
  echo.
  goto :fim
)
docker compose -f "%COMPOSE%" down -v
echo.
echo   Volumes removidos. Rode "fir" para subir um ambiente limpo.
echo.
goto :fim

REM ---------------------------------------------------------------------------
:status
echo.
docker compose -f "%COMPOSE%" ps
echo.
goto :fim

:logs
docker compose -f "%COMPOSE%" logs -f
goto :fim

:psql
docker exec -it fir-postgres psql -U fir -d fir
goto :fim

REM ---------------------------------------------------------------------------
:fim
if "%DUPLO%"=="1" (
  echo.
  pause
)
exit /b %CODIGO%
