export const timeZone = "America/Sao_Paulo";
const operatingDays = new Set(["Thu", "Fri", "Sat", "Sun"]);
const clock = new Intl.DateTimeFormat("en-US", {
  timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function localParts(date) {
  return Object.fromEntries(
    clock
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.type === "weekday" ? p.value : Number(p.value)]),
  );
}
function localTime(year, month, day, hour) {
  const target = Date.UTC(year, month - 1, day, hour);
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(instant));
    instant +=
      target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  return new Date(instant);
}
export function getAvailability(shop, now = new Date()) {
  const p = localParts(now);
  const state = {
    open: false,
    timeZone,
    serverNow: now.toISOString(),
    nextOpenAt: null,
    nextCloseAt: null,
    reason: "schedule",
    shortLabel: "",
    message: "",
  };
  if (!shop.acceptingOrders)
    return {
      ...state,
      reason: "paused",
      shortLabel: "Pedidos pausados",
      message:
        "Os pedidos estão pausados no momento. Consulte o atendimento pelo WhatsApp.",
    };
  if (!shop.enforceHours)
    return {
      ...state,
      open: true,
      reason: "override",
      shortLabel: "Aberto para pedidos",
      message: "Estamos abertos para pedidos.",
    };
  if (operatingDays.has(p.weekday) && p.hour >= 18) {
    return {
      ...state,
      open: true,
      reason: "open",
      nextCloseAt: localTime(p.year, p.month, p.day + 1, 0).toISOString(),
      shortLabel: "Aberto · pedidos até meia-noite",
      message:
        "Estamos abertos. Recebemos pedidos até meia-noite, no horário de Brasília.",
    };
  }
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = localTime(p.year, p.month, p.day + offset, 18);
    if (candidate <= now || !operatingDays.has(localParts(candidate).weekday))
      continue;
    const label =
      offset === 0
        ? "hoje"
        : offset === 1
          ? "amanhã"
          : new Intl.DateTimeFormat("pt-BR", {
              timeZone,
              weekday: "long",
            }).format(candidate);
    return {
      ...state,
      nextOpenAt: candidate.toISOString(),
      shortLabel: `Fechado · abrimos ${label} às 18h`,
      message: `Estamos fechados agora. Abrimos ${label} às 18h, no horário de Brasília. Você pode consultar o cardápio e deixar seu carrinho montado para depois.`,
    };
  }
  throw new Error("Não foi possível determinar a próxima abertura.");
}
