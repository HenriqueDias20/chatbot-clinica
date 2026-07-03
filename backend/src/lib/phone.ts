/**
 * Normaliza telefone antes de salvar (regra de negócio):
 * remove +, espaços, traços, parênteses — mantém só dígitos.
 * Ex.: "+55 (11) 98888-7777" -> "5511988887777"
 */
export function normalizePhone(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}
