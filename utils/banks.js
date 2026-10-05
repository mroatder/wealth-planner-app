// Words that identify each bank / e-wallet inside a wallet's NAME, so a slip can pick the matching wallet.
// Keys are the codes returned by the slip parser (server/utils/parse-slip.js).
export const BANK_ALIASES = {
  scb: ['scb', 'ไทยพาณิชย์'],
  kbank: ['kbank', 'กสิกร', 'k plus', 'kplus'],
  ktb: ['ktb', 'กรุงไทย', 'krungthai'],
  bbl: ['bbl', 'กรุงเทพ', 'bangkok bank', 'bualuang'],
  ttb: ['ttb', 'ทหารไทย', 'ธนชาต', 'tmb'],
  gsb: ['gsb', 'ออมสิน', 'mymo'],
  krungsri: ['krungsri', 'กรุงศรี', 'kma'],
  uob: ['uob', 'ยูโอบี'],
  cimb: ['cimb', 'ซีไอเอ็มบี'],
  lhbank: ['lh bank', 'แลนด์'],
  kkp: ['kkp', 'เกียรตินาคิน', 'tisco', 'ทิสโก้'],
  baac: ['baac', 'ธกส', 'ธ.ก.ส', 'เพื่อการเกษตร'],
  ghb: ['ghb', 'อาคารสงเคราะห์'],
  truemoney: ['truemoney', 'true money', 'ทรู'],
  paotang: ['เป๋าตัง', 'paotang'],
  linepay: ['line pay', 'linepay', 'ไลน์'],
  shopeepay: ['shopee', 'ช้อปปี้'],
};

export function walletForBank(wallets, bank) {
  const hints = BANK_ALIASES[bank];
  if (!hints) return null;
  return wallets.find((w) => hints.some((h) => (w.name ?? '').toLowerCase().includes(h))) ?? null;
}

// The wallet pre-selected in forms: the Siam Commercial Bank one (matched on its name), else the first wallet.
// Change the words here to change the default everywhere.
export const DEFAULT_WALLET_HINTS = ['ไทยพาณิชย์', 'scb'];

export function defaultWallet(wallets) {
  return wallets.find((w) => DEFAULT_WALLET_HINTS.some((h) => (w.name ?? '').toLowerCase().includes(h))) ?? wallets[0];
}
