# 🚀 Deploy — Opção A (Railway + Vercel + Supabase)

Arquitetura em produção:

- **Banco de dados** → Supabase (já existe)
- **Backend** (Fastify + WebSocket + cron + webhook) → **Railway**
- **Frontend** (painel React) → **Vercel**

> Ordem recomendada: **1) GitHub → 2) Supabase → 3) Railway (backend) → 4) Vercel (frontend) → 5) fechar CORS → 6) Meta/WhatsApp → 7) Anthropic**.

---

## 0. Contas necessárias (grátis pra começar)
- [GitHub](https://github.com) (guardar o código)
- [Railway](https://railway.app) (backend)
- [Vercel](https://vercel.com) (frontend)
- Supabase (já tem)
- Meta Business + WhatsApp (você vai configurar hoje)
- Anthropic (chave do Claude)

---

## 1. Subir o código no GitHub
No terminal, dentro da pasta do projeto:

```bash
git init
git add .
git commit -m "Chatbot fisioterapia — pronto para deploy"
```

Crie um repositório **privado** no GitHub (ex: `chatbot-clinica`) e conecte:

```bash
git remote add origin https://github.com/<seu-usuario>/chatbot-clinica.git
git branch -M main
git push -u origin main
```

> O `.gitignore` já ignora `.env` e `node_modules` — suas senhas não vão pro GitHub.

---

## 2. Supabase — pegar a conexão certa
1. Supabase → **Project Settings → Database**.
2. (Recomendado) **Reset database password** e anote a nova senha.
3. Em **Connection string**, escolha a aba **Session pooler** (é IPv4 — funciona no Railway).
   - Fica assim: `postgresql://postgres.<ref>:<SENHA>@aws-1-<regiao>.pooler.supabase.com:5432/postgres`
   - ⚠️ **Não** use a "Direct connection" (é IPv6, o Railway não conecta).
4. Guarde essa URL — é o `DATABASE_URL`.

---

## 3. Railway — backend
1. **New Project → Deploy from GitHub repo** → escolha o repositório.
2. Nas configurações do serviço → **Settings → Root Directory** = `backend`.
   - O Railway vai usar o `backend/Dockerfile` e o `backend/railway.json` automaticamente (build + migrations + start).
3. **Variables** (aba do serviço) — adicione:

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | a URL do **Session pooler** do Supabase (passo 2) |
   | `JWT_SECRET` | um segredo forte — gere com `openssl rand -hex 32` |
   | `FRONTEND_URL` | *(preenche depois, no passo 5)* — por enquanto `http://localhost:5173` |
   | `ANTHROPIC_API_KEY` | *(passo 7 — pode deixar vazio no começo)* |
   | `CLAUDE_MODEL` | `claude-haiku-4-5` |
   | `WHATSAPP_TOKEN` | *(passo 6)* |
   | `WHATSAPP_PHONE_NUMBER_ID` | *(passo 6)* |
   | `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | um texto que você inventa (ex: `meu-token-123`) |
   | `WHATSAPP_APP_SECRET` | *(passo 6)* |
   | `REDIS_ENABLED` | `false` |
   | `TIMEZONE` | `America/Sao_Paulo` |

4. **Deploy**. No primeiro deploy o `railway.json` já roda as **migrations** automaticamente.
5. Depois do deploy, gere um domínio público: **Settings → Networking → Generate Domain**.
   - Anote a URL (ex: `https://chatbot-clinica-production.up.railway.app`).
6. **Rodar o seed UMA vez** (cria os usuários de login e os dados iniciais):
   - Railway → serviço → aba **… (Command / Shell)** ou use a Railway CLI:
     ```bash
     railway run npm run seed
     ```
   - Isso cria o login `recepcao@clinica.com` / `clinica123` (⚠️ troque a senha depois).
7. Teste: abra `https://<sua-url-railway>/health` → deve responder `{"status":"ok"}`.

---

## 4. Vercel — frontend
1. **Add New → Project** → importe o mesmo repositório do GitHub.
2. **Root Directory** = `frontend`.
   - Framework detectado: **Vite** (build `npm run build`, output `dist`).
3. **Environment Variables**:
   | Variável | Valor |
   |---|---|
   | `VITE_API_URL` | a URL pública do backend no Railway (passo 3.5) |
4. **Deploy**. Anote a URL final (ex: `https://chatbot-clinica.vercel.app`).

---

## 5. Fechar o CORS (ligar frontend ↔ backend)
1. Volte no **Railway → Variables** e ajuste:
   - `FRONTEND_URL` = a URL da Vercel (passo 4).
2. O Railway faz **redeploy** sozinho.
3. Abra a URL da Vercel e faça login (`recepcao@clinica.com` / `clinica123`).
   - Se o painel carregar e mostrar as conversas em tempo real, está tudo conectado. ✅

---

## 6. Meta / WhatsApp Cloud API
> Você vai fazer isso quando tiver o número comprado e vinculado ao Meta.

1. No **Meta for Developers** → seu App → **WhatsApp → Configuration**.
2. **Webhook**:
   - **Callback URL** = `https://<sua-url-railway>/webhook`
   - **Verify token** = o mesmo texto que você pôs em `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
   - Assine o campo **messages**.
3. Copie e coloque no Railway (Variables):
   - `WHATSAPP_TOKEN` (token de acesso), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`.
4. Redeploy automático. Mande uma mensagem de teste pro número → deve cair no painel.

> ⚠️ O número usado no Cloud API vira "só API" — não dá mais pra usar no app normal do WhatsApp.

---

## 7. Anthropic (Claude)
1. Crie a chave em <https://console.anthropic.com> e **adicione créditos**.
2. Railway → Variables → `ANTHROPIC_API_KEY` = a chave.
3. Redeploy. Com a chave preenchida, o bot passa a usar o Claude (antes ficava em modo MOCK).

---

## ✅ Checklist rápido
- [ ] Código no GitHub
- [ ] `DATABASE_URL` (Session pooler do Supabase)
- [ ] `JWT_SECRET` forte
- [ ] Backend no Railway com domínio público + `/health` OK
- [ ] `npm run seed` rodado uma vez
- [ ] Frontend no Vercel com `VITE_API_URL`
- [ ] `FRONTEND_URL` no Railway = URL da Vercel
- [ ] Login funcionando no painel
- [ ] (quando tiver) Webhook do WhatsApp + credenciais Meta
- [ ] (quando tiver) `ANTHROPIC_API_KEY` com créditos
- [ ] Trocar a senha padrão do login

---

## 💰 Custo aproximado
- Railway (backend): ~US$5/mês
- Vercel (frontend): grátis (Hobby)
- Supabase (banco): grátis pra começar (Pro US$25/mês quando quiser backup diário)
- Claude: por uso (~US$1–5/mês em volume de clínica)
- WhatsApp: cobrança da Meta por conversa (varia)
