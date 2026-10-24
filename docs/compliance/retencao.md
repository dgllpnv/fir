# Retenção e eliminação de dado pessoal

> **Estado: a escrever.** Dono: `especialista-lgpd-saude`. Entrega da **Fase 0.5** da pipeline.
> **Nenhum campo pessoal entra no modelo sem uma linha nesta tabela.**

Este documento precisa conter, e não está completo sem:

## 1. A tabela
Uma linha por classe de dado pessoal:

| Dado | Finalidade | Base legal | Titular | Prazo | Ação no fim |
|---|---|---|---|---|---|

As classes já conhecidas, do protótipo e da v20 — nome, telefone, aniversário, histórico de contato, valor pago, saldo, **dose, produto, lote e aplicação por paciente**, salário, contrato, admissão, férias, documento com validade, banco de horas, foto de nota fiscal.

## 2. A separação que importa
Dado **sensível de saúde** (art. 11) tem regime próprio e não se mistura com dado de relacionamento (art. 7º). Misturar faz o regime mais rígido contaminar o produto inteiro, e a clínica perder o uso comercial legítimo do segundo.

## 3. Eliminação implementável
Com movimento de estoque append-only e trilha de auditoria imutável, "apagar o paciente" **não** pode significar `DELETE`. Descreva aqui o que significa: anonimizar o vínculo, preservar a contagem, e o que resta recuperável.

## 4. Exportação
O que o titular leva, e **o que ele não pode levar** — o extrato de um paciente não inclui o nome de quem aplicou nem o de outro paciente do mesmo lote.

## 5. Registro de acesso
Que leituras geram trilha: ficha de paciente com histórico de aplicação, ficha de pessoa com salário, qualquer rota do painel interno. Para dado sensível, saber **quem leu** é tão exigível quanto saber quem escreveu.

## 6. Incidente
O que torna o vazamento **detectável** — sem isso, o prazo de comunicação à ANPD começa a correr sem ninguém saber.

## 7. Operador e controlador
A clínica é controladora; nós somos operadores. A minuta de DPA e o que ela precisa cobrir. Ver pendência P-3 em `docs/decisoes.md`.
