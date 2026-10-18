const cache = new Map();
// Endereço confirmado pelo proprietário; permite consultar o CEP da pizzaria sem serviço externo.
const knownPostalCodes = {
  23550170: {
    postalCode: "23550170",
    street: "Travessa Projetada C",
    district: "Santa Cruz",
    city: "Rio de Janeiro",
    state: "RJ",
    source: "shop",
  },
};
export async function postalLookup(value) {
  const cep = String(value || "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(cep))
    throw new Error("Informe um CEP válido com 8 números.");
  if (knownPostalCodes[cep]) return knownPostalCodes[cep];
  const old = cache.get(cep);
  if (old && old.until > Date.now()) return old.value;
  let response;
  try {
    response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    throw new Error(
      "Não foi possível consultar o CEP agora. Tente novamente ou fale pelo WhatsApp.",
    );
  }
  if (!response.ok)
    throw new Error("Consulta de CEP indisponível. Tente novamente.");
  const data = await response.json();
  if (data.erro) throw new Error("CEP não encontrado. Confira os números.");
  const result = {
    postalCode: cep,
    street: String(data.logradouro || ""),
    district: String(data.bairro || ""),
    city: String(data.localidade || ""),
    state: String(data.uf || ""),
  };
  if (cache.size > 2000) cache.clear();
  cache.set(cep, { value: result, until: Date.now() + 86400000 });
  return result;
}
export function normalized(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
