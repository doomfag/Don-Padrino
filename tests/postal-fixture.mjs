// External postal service fixture, loaded only by isolated test servers.
const originalFetch = globalThis.fetch;
const addresses = {
  23550170: {
    logradouro: "Travessa Projetada C",
    bairro: "Santa Cruz",
    localidade: "Rio de Janeiro",
    uf: "RJ",
  },
  23530000: {
    logradouro: "Rua de Teste",
    bairro: "Sepetiba",
    localidade: "Rio de Janeiro",
    uf: "RJ",
  },
  23575000: {
    logradouro: "Rua de Teste",
    bairro: "Urucânia",
    localidade: "Rio de Janeiro",
    uf: "RJ",
  },
  "01001000": {
    logradouro: "Praça da Sé",
    bairro: "Sé",
    localidade: "São Paulo",
    uf: "SP",
  },
};
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith("https://viacep.com.br/ws/")) {
    const cep = url.split("/")[4];
    return Response.json(addresses[cep] || { erro: true });
  }
  return originalFetch(input, init);
};
