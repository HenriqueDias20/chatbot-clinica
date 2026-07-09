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
