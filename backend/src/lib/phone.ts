/**
 * Normaliza telefone antes de salvar (regra de negócio):
 * remove +, espaços, traços, parênteses — mantém só dígitos.
 * Ex.: "+55 (11) 98888-7777" -> "5511988887777"
 */
export function normalizePhone(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

/**
 * Formata o número para ENVIO na Meta Cloud API, corrigindo o 9º dígito de
 * celulares brasileiros: a Meta entrega o `wa_id` sem o 9 (ex.: 555194068240),
 * mas o envio confiável precisa do 9 (5551994068240).
 * 55 + DDD(2) + 8 dígitos (=12) → insere o 9 após o DDD.
 */
export function toWhatsAppRecipient(raw: string): string {
  const d = normalizePhone(raw);
  if (d.startsWith('55') && d.length === 12) {
    return `${d.slice(0, 4)}9${d.slice(4)}`;
  }
  return d;
}

/**
 * Número DIGITADO no painel (ex.: "51 99406-8240") → mesmo formato do `wa_id`
 * que chega pelo webhook (555194068240), para achar o paciente certo.
 * Sem o 55, a Meta lê "51…" como Peru (+51) e não entrega (erro 131026).
 * Com "+" na frente, respeita o código de país digitado.
 */
export function normalizeTypedPhone(raw: string): string {
  const input = (raw ?? '').trim();
  let d = normalizePhone(input);
  // Sem "+": DDD + 8 dígitos, ou DDD + 9 + 8 dígitos (celular) → Brasil.
  if (!input.startsWith('+') && (d.length === 10 || (d.length === 11 && d[2] === '9'))) {
    d = `55${d}`;
  }
  // Celular com o 9 → formato do wa_id, sem o 9 (toWhatsAppRecipient recoloca no envio).
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') {
    d = `${d.slice(0, 4)}${d.slice(5)}`;
  }
  return d;
}
