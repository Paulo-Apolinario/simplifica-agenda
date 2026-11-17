// Dependency-free, deterministic PDF generator for immutable daily cash records.
// All amounts are stored in integer cents; PDF values are read from closing snapshots.
const plain = value => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?");
const escapePdf = value => plain(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const brl = cents => "R$ " + (Number(cents ?? 0) / 100).toFixed(2).replace(".", ",");
const methods = { dinheiro: "Dinheiro", pix: "Pix", cartao_credito: "Cartao de credito",
  cartao_debito: "Cartao de debito", transferencia: "Transferencia" };
export function cashClosingPdf({ businessName, closing, opening, receipts, movements = [] }) {
  const lines = [
    "SIMPLIFICA AGENDA  |  FECHAMENTO DIARIO DE CAIXA",
    "============================================================",
    "Estabelecimento: " + businessName,
    "Data do caixa: " + closing.cashDate,
    "Protocolo: " + closing.id,
    "Responsavel pela abertura: " + (opening?.openedByName ?? "Nao registrada"),
    "Abertura: " + (opening?.openedAt ?? "Nao registrada"),
    "Responsavel pelo fechamento: " + closing.closedByName,
    "Fechado em: " + closing.closedAt,
    "------------------------------------------------------------",
    "Saldo inicial em especie: " + brl(closing.openingCashCents),
    "Recebimentos de servicos: " + brl(closing.expectedTotalCents),
    "Pagamentos em dinheiro: " + brl(closing.expectedCashCents),
    "Suprimentos em especie: " + brl(closing.supplyCents),
    "Sangrias em especie: " + brl(closing.withdrawalCents),
    "Dinheiro esperado (inicial + entradas - retiradas): " +
      brl(closing.openingCashCents + closing.expectedCashCents + closing.supplyCents - closing.withdrawalCents),
    "Dinheiro contado: " + brl(closing.countedCashCents),
    "Diferenca: " + brl(closing.differenceCents),
    "Atendimentos recebidos: " + closing.receiptCount,
    "------------------------------------------------------------",
    "FORMAS DE RECEBIMENTO",
    ...Object.entries(methods).map(([key, name]) => name + ": " + brl(closing.methods[key] || 0)),
    "------------------------------------------------------------",
    "REGISTROS DE RECEBIMENTO",
  ];
  if (!receipts.length) lines.push("Nenhum recebimento registrado neste dia.");
  for (const row of receipts) {
    lines.push((row.paidAt || row.startsAt || "").slice(0, 19) + " | " +
      (methods[row.paymentMethod] || row.paymentMethod || "-") + " | " + brl(row.priceCents));
    if (row.clientName || row.serviceName) lines.push("  " + plain((row.clientName || "") + " / " + (row.serviceName || "")).slice(0, 84));
  }
  lines.push("------------------------------------------------------------");
  lines.push("MOVIMENTACOES DE CAIXA");
  for (const movement of movements) lines.push(
    (movement.createdAt || "").slice(0, 19) + " | " +
    (movement.type === "sangria" ? "Sangria" : "Suprimento") +
    " | " + brl(movement.amountCents) + " | " + plain(movement.reason).slice(0, 65));
  if (!movements.length) lines.push("Nenhuma movimentacao adicional.");
  lines.push("------------------------------------------------------------");
  lines.push("Observacoes: " + (closing.notes || "Nenhuma"));
  lines.push("Documento gerado a partir do fechamento registrado.");
  if (!closing.receiptsSnapshotJson) lines.push("Registro historico: detalhes reconstituidos dos pagamentos atuais.");
  const perPage = 56;
  const wrapped = lines.flatMap(line => plain(line).match(/.{1,96}/g) || [""]);
  const pages = [];
  for (let i = 0; i < wrapped.length; i += perPage) pages.push(wrapped.slice(i, i + perPage));
  const objects = [null];
  const add = content => { objects.push(content); return objects.length - 1; };
  const catalog = add("");
  const pagesRoot = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  const kids = [];
  for (const [index, pageLines] of pages.entries()) {
    const commands = ["BT", "/F1 9 Tf", "12 TL", "40 805 Td"];
    for (const line of pageLines) {
      const chunks = plain(line).match(/.{1,98}/g) || [""];
      for (const chunk of chunks) commands.push("(" + escapePdf(chunk) + ") Tj", "T*");
    }
    commands.push("ET");
    const content = commands.join("\n") + "\n";
    const stream = add("<< /Length " + Buffer.byteLength(content, "latin1") + " >>\nstream\n" + content + "endstream");
    const page = add("<< /Type /Page /Parent " + pagesRoot + " 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 " + font + " 0 R >> >> /Contents " + stream + " 0 R >>");
    kids.push(page + " 0 R");
  }
  objects[catalog] = "<< /Type /Catalog /Pages " + pagesRoot + " 0 R >>";
  objects[pagesRoot] = "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + kids.length + " >>";
  const segments = ["%PDF-1.4\n"];
  const offsets = [0];
  let offset = Buffer.byteLength(segments[0], "latin1");
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = offset;
    const segment = i + " 0 obj\n" + objects[i] + "\nendobj\n";
    segments.push(segment); offset += Buffer.byteLength(segment, "latin1");
  }
  const xref = offset;
  segments.push("xref\n0 " + objects.length + "\n0000000000 65535 f \n");
  for (let i = 1; i < objects.length; i++) segments.push(String(offsets[i]).padStart(10, "0") + " 00000 n \n");
  segments.push("trailer\n<< /Size " + objects.length + " /Root " + catalog + " 0 R >>\nstartxref\n" + xref + "\n%%EOF");
  return Buffer.from(segments.join(""), "latin1");
}
