// Run with:  npm run test:slip
// Texts below imitate the OCR output of typical Thai banking apps (layouts written from memory of how those slips
// read, not copied from real slips) plus common OCR noise. Add your own failing slip text as a new case.
import assert from 'node:assert/strict';
import { parseSlip } from '../server/utils/parse-slip.js';

const NOW = new Date('2026-10-10T00:00:00Z');
const at = (d, t = '12:00') => `${d}T${t}:00+07:00`;

const cases = [
  {
    name: 'SCB Easy: labelled amount, sender first, memo',
    text: `โอนเงินสำเร็จ
05 ต.ค. 2568 - 14:32 น.
จาก
นาย ทดสอบ ระบบ
ธนาคารไทยพาณิชย์ xxx-x-x1234-x
ไปยัง
นาง สมหญิง ใจดี
ธนาคารกสิกรไทย xxx-x-x5678-x
จำนวนเงิน 1,250.00 บาท
ค่าธรรมเนียม 0.00 บาท
รหัสอ้างอิง 202510051432ABCDE
บันทึกช่วยจำ ค่าอาหาร`,
    expect: { amount: 1250, occurredAt: at('2025-10-05', '14:32'), bank: 'scb', recipient: 'นาง สมหญิงใจดี', memo: 'ค่าอาหาร', confidence: 'high' },
  },
  {
    name: 'K PLUS: "จำนวน:" and 2-digit Buddhist year',
    text: `K PLUS
โอนเงินสำเร็จ
5 ต.ค. 68 14:32 น.
นาย ทดสอบ ระบบ
ธ.กสิกรไทย
xxx-x-x1234-x
นาย ใจดี มีสุข
ธ.ไทยพาณิชย์
xxx-x-x5678-x
จำนวน: 500.00 บาท
ค่าธรรมเนียม: 0.00 บาท`,
    expect: { amount: 500, occurredAt: at('2025-10-05', '14:32'), bank: 'kbank' },
  },
  {
    name: 'Krungthai NEXT: amount on the line after its label, fee below',
    text: `Krungthai NEXT
ทำรายการสำเร็จ
05 ต.ค. 2568 14:32
จำนวนเงิน
500.00 บาท
ค่าธรรมเนียม
0.00 บาท`,
    expect: { amount: 500, occurredAt: at('2025-10-05', '14:32'), bank: 'ktb' },
  },
  {
    name: 'Bualuang mBanking: "(บาท)" between label and value',
    text: `Bualuang mBanking
โอนเงินสำเร็จ
05 ต.ค. 68 14:32
จำนวนเงิน (บาท) 500.00
ค่าธรรมเนียม (บาท) 0.00`,
    expect: { amount: 500, occurredAt: at('2025-10-05', '14:32'), bank: 'bbl' },
  },
  {
    name: 'ttb touch: numeric dd/mm/yyyy with seconds, THB',
    text: `ttb touch
โอนเงินสำเร็จ
05/10/2568 14:32:10
จำนวนเงิน 1,000.00 THB`,
    expect: { amount: 1000, occurredAt: at('2025-10-05', '14:32'), bank: 'ttb' },
  },
  {
    name: 'GSB MyMo: จำนวนเงินโอน',
    text: `MyMo
โอนเงินสำเร็จ
5 ต.ค. 2568 14:32 น.
จำนวนเงินโอน 300.00 บาท`,
    expect: { amount: 300, occurredAt: at('2025-10-05', '14:32'), bank: 'gsb' },
  },
  {
    name: 'Krungsri KMA: English month, Amount ... THB',
    text: `KMA
Transfer successful
5 Oct 2025 14:32
Amount 250.00 THB
Fee 0.00 THB`,
    expect: { amount: 250, occurredAt: at('2025-10-05', '14:32'), bank: 'krungsri' },
  },
  {
    name: 'TrueMoney: ฿ symbol',
    text: `TrueMoney Wallet
โอนเงินสำเร็จ
5 ต.ค. 2568 14:32 น.
ยอดเงิน ฿ 120.00`,
    expect: { amount: 120, occurredAt: at('2025-10-05', '14:32'), bank: 'truemoney' },
  },
  {
    name: 'Paotang: ยอดชำระ',
    text: `เป๋าตัง
ชำระเงินสำเร็จ
5 ต.ค. 68 14:32
ยอดชำระ 59.00 บาท`,
    expect: { amount: 59, occurredAt: at('2025-10-05', '14:32'), bank: 'paotang' },
  },
  {
    name: 'OCR noise: letters split by spaces, dropped dots, "1.250.00", dotted time',
    text: `โ อ น เ งิ น ส ำ เ ร็ จ
5 ต ค 68 - 14.32 น.
จ า น ว น เ ง ิ น 1.250.00 บ า ท
ไ ท ย พ า ณิ ช ย์`,
    expect: { amount: 1250, occurredAt: at('2025-10-05', '14:32'), bank: 'scb' },
  },
  {
    name: 'Thai digits',
    text: `โอนเงินสำเร็จ
๕ ต.ค. ๖๘ ๑๔:๓๒ น.
จำนวนเงิน ๑,๒๕๐.๐๐ บาท`,
    expect: { amount: 1250, occurredAt: at('2025-10-05', '14:32') },
  },
  {
    name: 'OCR reads a zero as the letter O',
    text: `5 ต.ค. 2568 14:32
จำนวนเงิน 1,25O.00 บาท`,
    expect: { amount: 1250, occurredAt: at('2025-10-05', '14:32') },
  },
  {
    name: 'No label: the fee line is ignored, the unit-tagged amount wins',
    text: `โอนเงินสำเร็จ
05 ต.ค. 68 14:32 น.
ค่าธรรมเนียม 5.00 บาท
500.00 บาท`,
    expect: { amount: 500, occurredAt: at('2025-10-05', '14:32'), confidence: 'medium' },
  },
  {
    name: 'English fee line with a real fee is ignored when there is no label',
    text: `KMA
5 Oct 2025 14:32
Fee 5.00 THB
250.00 THB`,
    expect: { amount: 250, occurredAt: at('2025-10-05', '14:32') },
  },
  {
    name: 'Nothing but a bare number; "14.32 น." must not be taken as an amount',
    text: `05 ต.ค. 68 14.32 น.
1,250.00`,
    expect: { amount: 1250, occurredAt: at('2025-10-05', '14:32') },
  },
  {
    name: 'Full month name and "เวลา"',
    text: `5 ตุลาคม 2568 เวลา 14:32 น.
จำนวนเงิน 80.00 บาท`,
    expect: { amount: 80, occurredAt: at('2025-10-05', '14:32') },
  },
  {
    name: 'Date without a time falls back to noon',
    text: `5 ต.ค. 2568
จำนวนเงิน 80.00 บาท`,
    expect: { amount: 80, occurredAt: at('2025-10-05', '12:00') },
  },
  {
    name: 'A date far in the future is rejected (misread year)',
    text: `5 ต.ค. 2599 14:32
จำนวนเงิน 80.00 บาท`,
    expect: { amount: 80, occurredAt: null, confidence: 'partial' },
  },
  {
    name: 'Balance lines are not the amount',
    text: `5 ต.ค. 2568 14:32
ยอดเงินคงเหลือ 12,345.67 บาท
จำนวนเงิน 500.00 บาท`,
    expect: { amount: 500 },
  },
  {
    name: '"กรุงเทพมหานคร" in an address is not Bangkok Bank',
    text: `ไทยพาณิชย์
123 ถนนสีลม กรุงเทพมหานคร
จำนวนเงิน 500.00 บาท`,
    expect: { amount: 500, bank: 'scb' },
  },
  {
    name: 'Sender bank wins over receiver bank',
    text: `ธนาคารกสิกรไทย
ไปยัง ธนาคารไทยพาณิชย์
จำนวนเงิน 500.00 บาท`,
    expect: { amount: 500, bank: 'kbank' },
  },
  {
    name: 'Empty / unreadable text',
    text: '   ',
    expect: { amount: null, occurredAt: null, bank: null, confidence: 'none' },
  },
  {
    name: 'Garbage text does not invent values',
    text: 'asdf qwer 12 34 zxcv',
    expect: { amount: null, occurredAt: null },
  },
];

let failed = 0;
for (const c of cases) {
  const got = parseSlip(c.text, NOW);
  try {
    for (const [key, want] of Object.entries(c.expect)) assert.equal(got[key], want, `${key}: got ${JSON.stringify(got[key])}, want ${JSON.stringify(want)}`);
    console.log(`ok    ${c.name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${c.name}\n      ${e.message}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
