<script setup>
// "บันทึก": the page for DOING a transaction. Browsing / editing past ones lives in /history.
const supabase = useSupabaseClient();
const user = useSupabaseUser();
const uid = computed(() => user.value?.id ?? user.value?.sub);

const TYPES = [
  { value: 'expense', label: 'รายจ่าย' },
  { value: 'income', label: 'รายรับ' },
  { value: 'transfer', label: 'โอนระหว่างกระเป๋า' },
];
const WALLET_TYPES = { cash: 'เงินสด', bank: 'บัญชีธนาคาร', credit_card: 'บัตรเครดิต', investment: 'การลงทุน', other: 'อื่นๆ' };

// ---------- data ----------
// three queries started together (they used to run one after another)
const opts = { default: () => [] };
const { data: wallets, refresh: refreshWallets, error: walletsErr, loaded: walletsLoaded } = useLoad('wallets', async () => {
  const { data, error } = await supabase.from('wallet_balances').select('wallet_id,name,type,balance').order('name');
  if (error) throw error;
  return data;
}, opts);
const { data: categories, error: categoriesErr } = useLoad('categories', async () => {
  const { data, error } = await supabase.from('categories').select('id,name,type').order('name');
  if (error) throw error;
  return data;
}, opts);
const { data: partner } = useLoad('partner', async () => {
  const { data } = await supabase.from('users').select('partner_name,display_name').maybeSingle();
  return { name: data?.partner_name || 'แฟน', me: data?.display_name || 'เรา' };
}, { default: () => ({ name: 'แฟน', me: 'เรา' }) });

const loadError = computed(() => (walletsErr.value || categoriesErr.value)?.message ?? '');
const walletName = (id) => wallets.value.find((w) => w.wallet_id === id)?.name ?? '—';
const categoryName = (id) => categories.value.find((c) => c.id === id)?.name;

// ---------- form ----------
const form = reactive({
  type: 'expense', amount: '', walletId: '', toWalletId: '', categoryId: '', occurredAt: '', note: '',
  split: false, owed: '', isFixed: false, payer: 'me',
});
const showOwedInput = ref(false); // let the user override the 50/50 split
const owedTouched = ref(false); // stop auto-halving once the user types their own owed amount
const toNumber = (s) => Number(String(s ?? '').replace(/,/g, ''));
const partnerPaid = computed(() => form.type === 'expense' && form.payer === 'partner');
const splitActive = computed(() => form.type === 'expense' && (partnerPaid.value || form.split));
// My own share of the expense
const myShare = computed(() => (partnerPaid.value
  ? toNumber(form.owed)
  : Math.max(toNumber(form.amount) - (form.split ? toNumber(form.owed) : 0), 0)));

// The partner paying for something shared is always a split
watch(() => form.payer, (p) => { if (p === 'partner') form.split = true; });

// default split = half; keep following the amount until the user edits the field
watch(() => [splitActive.value, form.amount], () => {
  if (splitActive.value && !owedTouched.value) {
    const a = toNumber(form.amount);
    form.owed = a > 0 ? String(Math.round((a / 2) * 100) / 100) : '';
  }
});

const error = ref('');
const saving = ref(false);
const scanning = ref(false);
const slip = ref(null); // { driveFileId, url, rawText }
const camera = ref(null);
const gallery = ref(null);

const categoryOptions = computed(() => categories.value.filter((c) => c.type === form.type));

watch(() => form.type, () => { form.categoryId = ''; });
// Default wallet: see defaultWallet() in utils/banks.js (Siam Commercial Bank, else the first one)
watch(wallets, (list) => {
  if (!form.walletId && list.length) form.walletId = defaultWallet(list).wallet_id;
}, { immediate: true });
onMounted(() => { form.occurredAt = toLocalInput(new Date()); });

function resetForm() {
  Object.assign(form, { amount: '', categoryId: '', toWalletId: '', note: '', occurredAt: toLocalInput(new Date()), split: false, owed: '', isFixed: false, payer: 'me' });
  owedTouched.value = false;
  showOwedInput.value = false;
  slip.value = null;
}

// ---------- confirmation of what was just recorded ----------
// A manual save and a slip scan both end here, so the result is always shown in the same place.
const saved = ref(null); // { id, kind: 'manual' | 'slip', title, amount, type, when, walletName, categoryId, slipUrl, dateGuessed, driveError }
const slipMsg = ref('');
const notice = ref(''); // positive message after a successful read
const lastOcr = ref(null); // what the server read from the last slip, for troubleshooting
const showOcr = ref(false);
const slipCandidates = ref([]); // other amounts found on the slip, one tap to switch

async function undoSaved() {
  const { data: gone, error: err } = await supabase.rpc('delete_transaction', { p_id: saved.value.id }); // POST, not DELETE
  if (err) return (slipMsg.value = /could not find the function|PGRST202/i.test(`${err.message} ${err.code}`) ? 'ยังไม่ได้รัน migration 004_delete_functions.sql ใน Supabase' : err.message);
  if (!gone) return (slipMsg.value = 'ลบไม่สำเร็จ: ไม่พบรายการนี้');
  saved.value = null;
  await refreshWallets();
}
async function changeSavedCategory(categoryId) {
  const { error: err } = await supabase.from('transactions').update({ category_id: categoryId }).eq('id', saved.value.id);
  if (err) return (slipMsg.value = err.message);
  saved.value.categoryId = categoryId;
}

// ---------- slip: read it and record the expense straight away ----------
const defaultCategoryId = computed(() => {
  const expense = categories.value.filter((c) => c.type === 'expense');
  return (expense.find((c) => /^(other|อื่นๆ)$/i.test(c.name)) ?? expense[0])?.id ?? null;
});

async function onSlipPicked(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  slipMsg.value = '';
  notice.value = '';
  lastOcr.value = null;
  showOcr.value = false;
  slipCandidates.value = [];
  saved.value = null;
  scanning.value = true;
  try {
    const body = new FormData();
    body.append('file', await compressImage(file));
    const res = await $fetch('/api/upload-slip', { method: 'POST', body });
    slip.value = res.slip ? { ...res.slip, rawText: res.rawText } : { rawText: res.rawText };
    lastOcr.value = { raw: res.rawText, ocrError: res.ocrError, driveError: res.driveError, engine: res.engine, note: res.ocrNote };
    const { amount, occurredAt, bank, recipient, memo, candidates } = res.extracted;
    slipCandidates.value = (candidates ?? []).filter((c) => c !== amount);

    form.type = 'expense';
    if (amount) form.amount = String(amount);
    if (occurredAt) form.occurredAt = toLocalInput(new Date(occurredAt));

    // Pick the wallet whose name matches the bank on the slip (the sender's bank is the first one named)
    const matched = bank && walletForBank(wallets.value, bank);
    if (matched) form.walletId = matched.wallet_id;

    if (!form.note || form.note === 'จากสลิป') form.note = memo || (recipient ? `โอนให้ ${recipient}` : 'จากสลิป');

    if (amount) {
      notice.value = '✨ ดึงข้อมูลจากสลิปเรียบร้อยแล้ว! กรุณาตรวจสอบยอด หมวดหมู่ และกระเป๋าเงินด้านล่าง แล้วกด "บันทึกรายการ"';
    } else {
      slipMsg.value = (res.ocrError
        ? 'ระบบอ่านตัวหนังสือจากรูปไม่สำเร็จ'
        : res.rawText?.trim() ? 'อ่านข้อความได้ แต่หาตัวเลขยอดเงินไม่เจอ' : 'ไม่พบตัวหนังสือในรูป')
        + ' กรุณากรอกยอดและรายละเอียดเองด้านล่าง';
      showOcr.value = true;
    }

    const formEl = document.getElementById('amount');
    if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    slipMsg.value = e?.data?.statusMessage || e?.message || 'อ่านสลิปไม่สำเร็จ กรอกข้อมูลเองได้';
  } finally {
    scanning.value = false;
  }
}

// ---------- save ----------
async function save() {
  error.value = '';
  const amount = toNumber(form.amount);
  const isTransfer = form.type === 'transfer';
  const needsCategory = form.type === 'expense' || form.type === 'income';
  const split = form.type === 'expense' ? toNumber(form.owed) : 0;
  const owed = form.type === 'expense' && form.payer === 'me' && form.split ? split : 0;
  if (!(amount > 0)) return (error.value = 'กรุณากรอกจำนวนเงิน');
  if (form.type === 'expense' && !form.note.trim()) return (error.value = 'กรุณาใส่รายละเอียด (ค่าอะไร)');
  if (partnerPaid.value && !(split > 0 && split <= amount)) return (error.value = 'ส่วนของเราต้องมากกว่า 0 และไม่เกินยอดรวม');
  if (!form.walletId) return (error.value = 'กรุณาเลือกกระเป๋า');
  if (isTransfer && (!form.toWalletId || form.toWalletId === form.walletId)) return (error.value = 'เลือกกระเป๋าปลายทางที่ต่างจากต้นทาง');
  if (needsCategory && !form.categoryId) return (error.value = 'กรุณาเลือกหมวดหมู่');
  if (Number.isNaN(owed) || owed < 0 || owed > amount) return (error.value = `ยอดที่${partner.value.name}ต้องจ่ายคืนต้องไม่เกินยอดรวม`);

  const stored = partnerPaid.value ? split : amount; // partner-paid: store only MY share
  const note = [form.note.trim(), partnerPaid.value ? `${partner.value.name}จ่าย ยอดรวม ${formatMoney(amount)}` : ''].filter(Boolean).join(' · ') || null;
  const when = new Date(form.occurredAt).toISOString();

  saving.value = true;
  const { data: row, error: err } = await supabase.from('transactions').insert({
    user_id: uid.value,
    type: form.type,
    amount: stored,
    owed_amount: owed,
    paid_by_partner: partnerPaid.value,
    is_shared: form.type === 'expense' && (partnerPaid.value || form.split),
    is_fixed: form.type === 'expense' && form.isFixed,
    wallet_id: form.walletId,
    to_wallet_id: isTransfer ? form.toWalletId : null,
    category_id: needsCategory ? form.categoryId : null,
    occurred_at: when,
    note,
    slip_drive_file_id: slip.value?.driveFileId ?? null,
    slip_url: slip.value?.url ?? null,
    ocr_raw_text: slip.value?.rawText ?? null,
  }).select('id').single();
  saving.value = false;
  if (err) return (error.value = err.message);

  slipMsg.value = '';
  saved.value = {
    id: row.id, kind: 'slip', type: form.type, amount: stored, when,
    title: isTransfer ? `${walletName(form.walletId)} → ${walletName(form.toWalletId)}` : (form.note.trim() || categoryName(form.categoryId) || 'รายการ'),
    walletName: partnerPaid.value ? null : walletName(form.walletId),
    categoryId: needsCategory ? form.categoryId : null,
    hasSlip: !!slip.value?.driveFileId,
  };
  resetForm();
  await refreshWallets();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- first wallet ----------
const newWallet = reactive({ name: '', type: 'cash', initial: '0' });
const walletError = ref('');
async function addWallet() {
  walletError.value = '';
  if (!newWallet.name.trim()) return (walletError.value = 'กรุณาตั้งชื่อกระเป๋า');
  const { error: err } = await supabase.from('wallets').insert({
    user_id: uid.value,
    name: newWallet.name.trim(),
    type: newWallet.type,
    initial_balance: Number(newWallet.initial) || 0,
  });
  if (err) return (walletError.value = err.message);
  Object.assign(newWallet, { name: '', type: 'cash', initial: '0' });
  await refreshWallets();
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <div class="flex items-end justify-between gap-4">
      <h1 class="title">บันทึกรายการ</h1>
      <div class="flex gap-4 pb-1 text-sm">
        <NuxtLink to="/history" class="text-accent">ประวัติ</NuxtLink>
        <NuxtLink to="/import" class="text-accent">นำเข้าจากชีต</NuxtLink>
      </div>
    </div>

    <p v-if="loadError" class="mt-6 rounded-lg bg-expense/10 px-4 py-3 text-sm text-expense">
      โหลดข้อมูลไม่สำเร็จ: {{ loadError }}
      <span class="block text-xs text-muted">ถ้าเพิ่งอัปเดตฐานข้อมูล ให้ตรวจว่ารัน migration 002a และ 002b ใน Supabase แล้ว</span>
    </p>

    <!-- Result of the last action -->
    <section v-if="saved" class="mt-6 space-y-3 rounded-xl bg-income/10 px-5 py-4">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <div class="text-sm font-medium">{{ saved.kind === 'slip' ? 'บันทึกรายจ่ายจากสลิปแล้ว' : 'บันทึกแล้ว' }}</div>
        <div class="num text-[20px] font-bold tracking-tight" :class="saved.type === 'income' ? 'text-income' : saved.type === 'expense' ? 'text-expense' : ''">
          {{ saved.type === 'income' ? '+' : saved.type === 'expense' ? '−' : '' }}{{ formatMoney(saved.amount) }}
        </div>
      </div>
      <div class="text-sm">{{ saved.title }}</div>
      <div class="text-xs text-muted">
        {{ formatDate(saved.when) }}{{ saved.dateGuessed ? ' (อ่านวันที่ไม่ได้ ใช้เวลาตอนนี้)' : '' }}<template v-if="saved.walletName"> · กระเป๋า {{ saved.walletName }}</template>
        <span v-if="saved.hasSlip"> · เก็บสลิปไว้แล้ว (เปิดดูได้ในประวัติ)</span>
        <span v-else-if="saved.driveError" class="text-expense"> · เก็บไฟล์สลิปไม่สำเร็จ: {{ saved.driveError }}</span>
      </div>
      <div v-if="saved.kind === 'slip'" class="flex flex-wrap items-center gap-3">
        <label class="text-xs text-muted" for="saved-cat">หมวดหมู่</label>
        <select id="saved-cat" :value="saved.categoryId" class="field w-auto py-1.5 text-sm" @change="changeSavedCategory($event.target.value)">
          <option v-for="c in categories.filter((x) => x.type === 'expense')" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>
      <p v-if="saved.kind === 'slip'" class="text-xs text-muted">ตรวจสอบยอดให้ตรงกับสลิป หากไม่ถูกต้องให้ลบแล้วกรอกเอง</p>
      <div class="flex items-center gap-5 pt-1 text-sm">
        <NuxtLink to="/history" class="text-accent">ดูในประวัติ</NuxtLink>
        <button class="text-expense" @click="undoSaved">เลิกทำ (ลบรายการนี้)</button>
        <button class="ml-auto text-muted" @click="saved = null">ปิด</button>
      </div>
    </section>

    <!-- No wallet yet -->
    <div v-if="!walletsLoaded && !loadError" class="mt-6 space-y-4">
      <div class="card h-20 animate-pulse bg-ink/5"></div>
      <div class="card h-80 animate-pulse bg-ink/5"></div>
    </div>

    <section v-else-if="!wallets.length && !loadError" class="mt-6">
      <p class="mb-3 text-sm text-muted">เริ่มจากสร้างกระเป๋าแรก เช่น เงินสด หรือบัญชีธนาคาร</p>
      <form class="card space-y-4 p-5" @submit.prevent="addWallet">
        <div>
          <label class="label" for="w-name">ชื่อกระเป๋า</label>
          <input id="w-name" v-model="newWallet.name" class="field" placeholder="เช่น เงินสด, กสิกร" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="w-type">ประเภท</label>
            <select id="w-type" v-model="newWallet.type" class="field">
              <option v-for="(label, key) in WALLET_TYPES" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>
          <div>
            <label class="label" for="w-init">ยอดทั้งหมด</label>
            <input id="w-init" v-model="newWallet.initial" inputmode="decimal" class="field num" />
          </div>
        </div>
        <p v-if="walletError" class="text-sm text-expense">{{ walletError }}</p>
        <button class="btn btn-primary">สร้างกระเป๋า</button>
      </form>
    </section>

    <template v-if="wallets.length">
      <!-- Attach a bank slip: read it and record the expense automatically -->
      <section id="slip" class="card mt-6 scroll-mt-20 px-5 py-4">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-[15px] font-semibold">แนบสลิปธนาคาร</div>
            <div class="text-sm text-muted">อ่านยอดและวันที่จากสลิป แล้วเติมลงฟอร์มให้ตรวจสอบก่อนกดบันทึก</div>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-primary" :disabled="scanning" @click="camera.click()">{{ scanning ? 'กำลังอ่านสลิป…' : 'ถ่ายรูปสลิป' }}</button>
            <button class="btn btn-quiet" :disabled="scanning" @click="gallery.click()">เลือกไฟล์</button>
          </div>
          <input ref="camera" type="file" accept="image/*" capture="environment" class="hidden" @change="onSlipPicked" />
          <input ref="gallery" type="file" accept="image/*" class="hidden" @change="onSlipPicked" />
        </div>
        <p v-if="notice" class="mt-3 rounded-lg bg-income/10 px-3 py-2 text-sm">{{ notice }}</p>
        <p v-if="slipMsg" class="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-sm">{{ slipMsg }}</p>

        <!-- Slip Image Preview -->
        <div v-if="slip?.url" class="mt-3 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3">
          <div class="flex items-center gap-3 min-w-0">
            <img :src="slip.url" alt="สลิปที่แนบ" class="h-16 w-12 rounded border border-line object-cover shrink-0" />
            <div class="min-w-0 text-xs">
              <div class="font-medium text-ink flex items-center gap-1">
                <span>📎 แนบรูปสลิปเรียบร้อยแล้ว</span>
              </div>
              <a :href="slip.url" target="_blank" rel="noopener" class="text-accent hover:underline">คลิกเพื่อดูรูปขนาดเต็ม ↗</a>
            </div>
          </div>
          <button type="button" class="btn btn-quiet px-2 py-1 text-xs text-expense" @click="slip = null">ยกเลิกรูปนี้</button>
        </div>
        <div v-if="slipCandidates.length" class="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span class="text-muted">ยอดไม่ถูก? ยอดอื่นที่พบในสลิป:</span>
          <button v-for="c in slipCandidates" :key="c" type="button" class="btn btn-quiet px-2.5 py-1 text-xs" @click="form.amount = String(c)">{{ formatMoney(c) }}</button>
        </div>

        <div v-if="lastOcr" class="mt-3">
          <button type="button" class="text-xs text-accent" @click="showOcr = !showOcr">{{ showOcr ? 'ซ่อน' : 'ดู' }}ข้อความที่ระบบอ่านจากสลิป</button>
          <div v-if="showOcr" class="mt-2 space-y-2 rounded-lg bg-ink/[0.04] p-3 text-xs">
            <p class="text-muted">เครื่องอ่าน: {{ lastOcr.engine === 'vision' ? 'Google Vision' : lastOcr.engine === 'tesseract' ? 'Tesseract' : '—' }}<template v-if="lastOcr.note"> · {{ lastOcr.note }}</template></p>
            <p v-if="lastOcr.ocrError" class="break-words text-expense">OCR ผิดพลาด: {{ lastOcr.ocrError }}</p>
            <p v-if="lastOcr.driveError" class="break-words text-expense">เก็บไฟล์สลิปไม่สำเร็จ: {{ lastOcr.driveError }}</p>
            <pre class="whitespace-pre-wrap break-words font-sans text-muted">{{ lastOcr.raw?.trim() || '(ไม่ได้ข้อความเลย)' }}</pre>
          </div>
        </div>
      </section>

      <!-- Manual entry -->
      <form class="card mt-4 space-y-5 p-5" @submit.prevent="save">
        <div class="segmented grid-cols-3">
          <button
            v-for="t in TYPES" :key="t.value" type="button"
            :aria-pressed="form.type === t.value"
            @click="form.type = t.value"
          >{{ t.label }}</button>
        </div>

        <div>
          <label class="label" for="amount">{{ partnerPaid ? `ยอดรวมที่${partner.name}จ่าย (บาท)` : 'จำนวนเงิน (บาท)' }}</label>
          <input
            id="amount" v-model="form.amount" inputmode="decimal" placeholder="0.00" autocomplete="off"
            class="field num py-2.5 text-[28px] font-semibold tracking-tight"
          />
        </div>

        <!-- EXPENSE: what → category → when → who paid → personal or shared → fixed -->
        <template v-if="form.type === 'expense'">
          <div>
            <label class="label" for="detail">ค่าอะไร</label>
            <input id="detail" v-model="form.note" class="field" maxlength="200" placeholder="เช่น ค่าอาหารกลางวัน, ค่าน้ำมัน, ค่าไฟ" />
          </div>

          <div>
            <label class="label" for="category">หมวดหมู่</label>
            <select id="category" v-model="form.categoryId" class="field">
              <option value="" disabled>เลือกหมวดหมู่</option>
              <option v-for="c in categoryOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>

          <div>
            <label class="label" for="when">วันที่และเวลา (24 ชม.)</label>
            <DateTimePicker24h id="when" v-model="form.occurredAt" />
          </div>

          <div>
            <div class="label">ใครเป็นคนจ่าย</div>
            <div class="segmented grid-cols-2">
              <button type="button" :aria-pressed="form.payer === 'me'" @click="form.payer = 'me'">{{ partner.me }}</button>
              <button type="button" :aria-pressed="form.payer === 'partner'" @click="form.payer = 'partner'">{{ partner.name }}</button>
            </div>
          </div>

          <div>
            <div class="label">จ่ายแบบไหน</div>
            <div class="segmented grid-cols-2">
              <button type="button" :aria-pressed="!form.split" :disabled="partnerPaid" class="disabled:opacity-40" @click="form.split = false">ส่วนตัว</button>
              <button type="button" :aria-pressed="form.split" @click="form.split = true">หาร 2</button>
            </div>
            <p v-if="partnerPaid" class="mt-1.5 text-xs text-muted">{{ partner.name }}จ่ายของตัวเองคนเดียวไม่ต้องบันทึก บันทึกเฉพาะที่หารกัน</p>

            <div v-if="splitActive" class="mt-3 rounded-lg bg-ink/[0.04] px-4 py-3">
              <div class="num flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                <span v-if="!partnerPaid" class="text-muted">{{ partner.name }}จ่ายคืน <span class="font-medium text-ink">{{ formatMoney(Math.max(toNumber(form.amount) - myShare, 0)) }}</span></span>
                <span v-else class="text-muted">เราต้องจ่ายคืน{{ partner.name }} <span class="font-medium text-ink">{{ formatMoney(myShare) }}</span></span>
                <span class="text-muted">ส่วนของเรา <span class="font-medium text-ink">{{ formatMoney(myShare) }}</span></span>
              </div>
              <button v-if="!showOwedInput" type="button" class="mt-1 text-xs text-accent" @click="showOwedInput = true">ปรับยอดที่หาร</button>
              <div v-else class="mt-3">
                <label class="label" for="owed">{{ partnerPaid ? 'ส่วนที่เราต้องจ่าย (บาท)' : `${partner.name}ต้องจ่ายคืน (บาท)` }}</label>
                <input id="owed" v-model="form.owed" inputmode="decimal" class="field num" @input="owedTouched = true" />
              </div>
            </div>
          </div>

          <ToggleRow v-model="form.isFixed" label="เป็นรายจ่ายประจำ (Fix cost)" hint="เช่น ค่าเช่า ค่าอินเทอร์เน็ต ค่าผ่อน" />

          <div v-if="form.payer === 'me'">
            <label class="label" for="wallet">จ่ายจากกระเป๋า</label>
            <select id="wallet" v-model="form.walletId" class="field">
              <option v-for="w in wallets" :key="w.wallet_id" :value="w.wallet_id">{{ w.name }} · {{ formatMoney(w.balance) }}</option>
            </select>
          </div>
        </template>

        <!-- INCOME / TRANSFER -->
        <template v-else>
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="label" for="wallet">{{ form.type === 'transfer' ? 'จากกระเป๋า' : 'รับเข้ากระเป๋า' }}</label>
              <select id="wallet" v-model="form.walletId" class="field">
                <option v-for="w in wallets" :key="w.wallet_id" :value="w.wallet_id">{{ w.name }} · {{ formatMoney(w.balance) }}</option>
              </select>
            </div>

            <div v-if="form.type === 'transfer'">
              <label class="label" for="to-wallet">ไปยังกระเป๋า</label>
              <select id="to-wallet" v-model="form.toWalletId" class="field">
                <option value="" disabled>เลือกกระเป๋า</option>
                <option v-for="w in wallets.filter((x) => x.wallet_id !== form.walletId)" :key="w.wallet_id" :value="w.wallet_id">{{ w.name }}</option>
              </select>
            </div>
            <div v-else>
              <label class="label" for="category">หมวดหมู่</label>
              <select id="category" v-model="form.categoryId" class="field">
                <option value="" disabled>เลือกหมวดหมู่</option>
                <option v-for="c in categoryOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
          </div>

          <div>
            <label class="label" for="when">วันที่และเวลา (24 ชม.)</label>
            <DateTimePicker24h id="when" v-model="form.occurredAt" />
          </div>

          <div>
            <label class="label" for="note">บันทึกเพิ่มเติม <span class="text-faint">(ไม่บังคับ)</span></label>
            <input id="note" v-model="form.note" class="field" maxlength="200" />
          </div>
        </template>

        <p v-if="error" class="text-sm text-expense">{{ error }}</p>
        <button class="btn btn-primary w-full" :disabled="saving || scanning">
          {{ saving ? 'กำลังบันทึก…' : 'บันทึกรายการ' }}
        </button>
      </form>
    </template>
  </div>
</template>
