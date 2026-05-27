export function normalizeCpf(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D/g, '');
}

export function isValidCnpj(raw: string | null | undefined): boolean {
  const cnpj = String(raw ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calcDigit = (base: string, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += parseInt(base[i], 10) * weights[i];
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return calcDigit(cnpj, w1) === parseInt(cnpj[12], 10) && calcDigit(cnpj, w2) === parseInt(cnpj[13], 10);
}

export function isValidDocument(raw: string | null | undefined): boolean {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

export function isValidCpf(raw: string | null | undefined): boolean {
  const cpf = normalizeCpf(raw);
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calcDigit = (base: string, factorStart: number): number => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += Number(base[i]) * (factorStart - i);
    }
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  const d1 = calcDigit(cpf.slice(0, 9), 10);
  const d2 = calcDigit(cpf.slice(0, 10), 11);
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}
