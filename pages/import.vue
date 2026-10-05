<script setup>
const supabase = useSupabaseClient();
const user = useSupabaseUser();
const uid = computed(() => user.value?.id ?? user.value?.sub);

const NEW = '__new__';
const text = ref('');
const fileName = ref('');
const walletId = ref('');
const mePayor = ref('');
const dontDeductWallet = ref(true); // default true for historical imports so wallet isn't negative
const mapping = reactive({}); // old category name -> category id | NEW
const busy = ref(false);
const result = ref(null);
const error = ref('');

const { data: wallets, loaded: walletsLoaded } = useLoad('import-wallets', async () => {
  const { data, error: err } = await supabase.from('wallets').select('id,name').eq('is_archived', false).order('name');
  if (err) throw err;
  return data;
}, { default: () => [] });
const { data: categories } = useLoad('import-categories', async () => {
  const { data, error: err } = await supabase.from('categories').select('id,name').eq('type', 'expense').order('name');
  if (err) throw err;
  return data;
}, { default: () => [] });

watch(wallets, (l) => { if (!walletId.value && l.length) walletId.value = l[0].id; }, { immediate: true });

async function onFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  fileName.value = file.name;
  text.value = await file.text();
  result.value = null;
}

// ---------- parse ----------
const COLUMNS = ['date', 'categories', 'detail', 'cost', 'ishalf', 'halfamount', 'payor', 'isfixed'];

const rows = computed(() => {
  const table = parseDelimited(text.value);
  if (!table.length) return [];
  const head = table[0].map((h) => h.trim().toLowerCase());
  const hasHeader = head.includes('date') && head.includes('cost');
  const idx = Object.fromEntries(COLUMNS.map((c, i) => [c, hasHeader && head.includes(c) ? head.indexOf(c) : i]));
  return (hasHeader ? table.slice(1) : table).map((r, n) => {
    const get = (c) => (r[idx[c]] ?? '').trim();
    const cost = Number(get('cost').replace(/,/g, ''));
    const isHalf = parseBool(get('ishalf'));
    const halfAmount = Number(get('halfamount').replace(/,/g, '')) || 0;
    const owed = isHalf ? Math.min(cost, halfAmount > 0 ? halfAmount : Math.round((cost / 2) * 100) / 100) : 0;
    return {
      line: n + 1 + (hasHeader ? 1 : 0),
      occurredAt: parseSheetDate(get('date')),
      category: get('categories'),
      detail: get('detail'),
      cost, owed, isHalf,
      payor: get('payor'),
      isFixed: parseBool(get('isfixed')),
    };
  });
});

const payors = computed(() => {
  const count = {};
  for (const r of rows.value) if (r.payor) count[r.payor] = (count[r.payor] || 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([name]) => name);
});
const oldCategories = computed(() => [...new Set(rows.value.map((r) => r.category).filter(Boolean))]);

watch(payors, (p) => { if (!p.includes(mePayor.value)) mePayor.value = p[0] ?? ''; }, { immediate: true });
watch([oldCategories, categories], () => {
  for (const name of oldCategories.value) {
    if (mapping[name]) continue;
    mapping[name] = categories.value.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id ?? NEW;
  }
}, { immediate: true });

// ok: I paid | partner: someone else paid and it was split (I owe them my share) | other: their own spending, skipped
const status = (r) => {
  if (!r.occurredAt || !(r.cost > 0)) return 'invalid';
  if (mePayor.value && r.payor && r.payor !== mePayor.value) return r.isHalf ? 'partner' : 'other';
  return 'ok';
};
const counts = computed(() => {
  const c = { ok: 0, partner: 0, invalid: 0, other: 0 };
  for (const r of rows.value) c[status(r)]++;
  return c;
});
const importable = computed(() => rows.value.filter((r) => ['ok', 'partner'].includes(status(r))));
const importCount = computed(() => counts.value.ok + counts.value.partner);

// What actually gets stored. Historical rows keep spending data without creating partner debt or lowering wallet balance.
function record(r) {
  const isPartnerPaid = status(r) === 'partner';
  return {
    amount: isPartnerPaid ? r.owed : r.cost,
    owed: 0,
    shared: isPartnerPaid || r.isHalf, // still shows under "ours" in the history view
    byPartner: false, // false ensures no partner debt (no red 'เราค้าง' warning)
    note: (isPartnerPaid ? [r.detail, `${r.payor}จ่าย ยอดรวม ${formatMoney(r.cost)}`].filter(Boolean).join(' · ') : r.detail) || null,
  };
}

// ---------- import ----------
async function runImport() {
  error.value = '';
  result.value = null;
  if (!walletId.value) return (error.value = 'กรุณาเลือกกระเป๋า');
  if (!importable.value.length) return (error.value = 'ไม่มีแถวที่นำเข้าได้');
  busy.value = true;
  try {
    // 1) create categories that don't exist yet
    const idByOld = {};
    const toCreate = [];
    for (const name of new Set(importable.value.map((r) => r.category || 'Other'))) {
      const chosen = mapping[name];
      if (chosen && chosen !== NEW) idByOld[name] = chosen;
      else toCreate.push(name);
    }
    if (toCreate.length) {
      const { data, error: err } = await supabase.from('categories')
        .upsert(toCreate.map((name) => ({ user_id: uid.value, name, type: 'expense' })), { onConflict: 'user_id,name,type' })
        .select('id,name');
      if (err) throw err;
      for (const c of data) idByOld[c.name] = c.id;
    }

    // 2) skip rows that were already imported (same time, amount and note)
    const times = importable.value.map((r) => new Date(r.occurredAt).getTime());
    const from = new Date(Math.min(...times) - 86400000).toISOString();
    const to = new Date(Math.max(...times) + 86400000).toISOString();
    const existing = new Set();
    for (let page = 0; ; page++) {
      const { data, error: err } = await supabase.from('transactions').select('occurred_at,amount,note')
        .gte('occurred_at', from).lte('occurred_at', to).order('id').range(page * 1000, page * 1000 + 999);
      if (err) throw err;
      for (const t of data) existing.add(`${new Date(t.occurred_at).getTime()}|${Number(t.amount).toFixed(2)}|${t.note ?? ''}`);
      if (data.length < 1000) break;
    }

    const fresh = importable.value.filter((r) => {
      const rec = record(r);
      return !existing.has(`${new Date(r.occurredAt).getTime()}|${rec.amount.toFixed(2)}|${rec.note ?? ''}`);
    });

    // 3) insert in batches
    const payload = fresh.map((r) => {
      const rec = record(r);
      return {
        user_id: uid.value,
        type: 'expense',
        amount: rec.amount,
        owed_amount: rec.owed,
        paid_by_partner: rec.byPartner,
        is_shared: rec.shared,
        is_fixed: r.isFixed,
        wallet_id: walletId.value,
        category_id: idByOld[r.category || 'Other'],
        occurred_at: r.occurredAt,
        note: rec.note,
      };
    });
    for (let i = 0; i < payload.length; i += 200) {
      const { error: err } = await supabase.from('transactions').insert(payload.slice(i, i + 200));
      if (err) throw err;
    }

    // 4) If dontDeductWallet is checked, auto-adjust the wallet initial_balance so the wallet balance stays unchanged
    if (dontDeductWallet.value && payload.length) {
      const totalImportedCost = payload.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const { data: wData } = await supabase.from('wallets').select('initial_balance').eq('id', walletId.value).maybeSingle();
      if (wData) {
        const currentInitial = Number(wData.initial_balance || 0);
        await supabase.from('wallets').update({ initial_balance: currentInitial + totalImportedCost }).eq('id', walletId.value);
      }
    }

    result.value = { imported: payload.length, duplicates: importable.value.length - payload.length };
  } catch (e) {
    error.value = e.message ?? String(e);
  } finally {
    busy.value = false;
  }
}

const clearing = ref(false);
const clearNotice = ref('');

async function clearAllTransactions() {
  if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบรายการทั้งหมด? ข้อมูลที่ลบแล้วไม่สามารถฟื้นคืนได้')) return;
  clearing.value = true;
  clearNotice.value = '';
  error.value = '';
  try {
    const { data: removed, error: err } = await supabase.rpc('delete_all_my_transactions'); // POST, not DELETE
    if (err) throw new Error(/could not find the function|PGRST202/i.test(`${err.message} ${err.code}`) ? 'ยังไม่ได้รัน migration 004_delete_functions.sql ใน Supabase' : err.message);
    clearNotice.value = `ลบรายการทั้งหมดเรียบร้อยแล้ว (${removed ?? 0} รายการ)`;
    result.value = null;
  } catch (e) {
    error.value = e.message || 'เกิดข้อผิดพลาดในการลบรายการ';
  } finally {
    clearing.value = false;
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <h1 class="title">นำเข้าจากชีต</h1>
    <p class="mt-2 text-sm text-muted">
      รองรับคอลัมน์ Date, Categories, Detail, Cost, IsHalf, HalfAmount, Payor, isFixed
      คัดลอกจาก Google Sheets วางได้เลย หรือเลือกไฟล์ CSV/TSV
    </p>

    <div v-if="!walletsLoaded" class="card mt-6 h-24 animate-pulse bg-ink/5"></div>
    <div v-else-if="!wallets.length" class="card mt-6 px-4 py-4 text-sm text-muted">
      ต้องมีกระเป๋าอย่างน้อย 1 ใบก่อน <NuxtLink to="/wallets" class="text-accent">ไปสร้างกระเป๋า</NuxtLink>
    </div>

    <template v-else>
      <section class="card mt-6 space-y-3 p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <label class="btn btn-quiet cursor-pointer">
              เลือกไฟล์
              <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" class="hidden" @change="onFile" />
            </label>
            <span class="text-sm text-muted">{{ fileName || 'หรือวางข้อมูลด้านล่าง' }}</span>
          </div>
          <button type="button" class="btn text-xs text-expense hover:bg-expense/10" :disabled="clearing" @click="clearAllTransactions">
            {{ clearing ? 'กำลังลบ…' : '🗑️ ลบรายการทั้งหมดที่มีอยู่' }}
          </button>
        </div>
        <p v-if="clearNotice" class="text-sm text-accent">{{ clearNotice }}</p>
        <textarea v-model="text" rows="6" class="field num text-[13px]" placeholder="Date&#9;Categories&#9;Detail&#9;Cost&#9;IsHalf&#9;HalfAmount&#9;Payor&#9;isFixed"></textarea>
      </section>

      <template v-if="rows.length">
        <section class="card mt-4 space-y-4 p-5">
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="label" for="i-payor">ผู้จ่ายที่เป็นตัวเรา</label>
              <select id="i-payor" v-model="mePayor" class="field">
                <option v-for="p in payors" :key="p" :value="p">{{ p }}</option>
              </select>
            </div>
            <div class="flex items-center pt-6">
              <label class="flex items-center gap-2 cursor-pointer text-sm font-medium">
                <input v-model="dontDeductWallet" type="checkbox" class="h-4 w-4 rounded accent-accent" />
                <span>นำเข้าเป็นประวัติย้อนหลังเท่านั้น (ไม่หักเงินในกระเป๋า)</span>
              </label>
            </div>
          </div>

          <div>
            <div class="label">จับคู่หมวดหมู่</div>
            <ul class="divide-y divide-line rounded-lg border border-line">
              <li v-for="name in oldCategories" :key="name" class="flex items-center justify-between gap-3 px-3 py-2">
                <span class="truncate text-sm">{{ name }}</span>
                <select v-model="mapping[name]" class="field w-auto max-w-[55%] py-1.5 text-sm">
                  <option :value="NEW">+ สร้างหมวดใหม่ “{{ name }}”</option>
                  <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </li>
            </ul>
          </div>

          <div class="text-sm">
            พร้อมนำเข้า <span class="num font-semibold">{{ importCount }}</span> แถว
            <template v-if="counts.partner"> (รวม <span class="num">{{ counts.partner }}</span> แถวที่คนอื่นจ่ายและหาร จะนับเฉพาะส่วนของเรา)</template>
            <template v-if="counts.other"> · ข้าม <span class="num">{{ counts.other }}</span> แถวที่คนอื่นจ่ายและไม่ได้หาร</template>
            <template v-if="counts.invalid"> · ข้าม <span class="num text-expense">{{ counts.invalid }}</span> แถวที่วันที่หรือยอดไม่ถูกต้อง</template>
          </div>

          <p v-if="error" class="text-sm text-expense">{{ error }}</p>
          <div v-if="result" class="rounded-lg bg-accent/10 px-3 py-2 text-sm">
            นำเข้าสำเร็จ {{ result.imported }} รายการ<template v-if="result.duplicates"> · ข้าม {{ result.duplicates }} รายการที่มีอยู่แล้ว</template>
            <NuxtLink to="/transactions" class="ml-1 text-accent">ดูรายการ</NuxtLink>
          </div>
          <button class="btn btn-primary" :disabled="busy || !importCount" @click="runImport">
            {{ busy ? 'กำลังนำเข้า…' : `นำเข้า ${importCount} รายการ` }}
          </button>
        </section>

        <h2 class="section-label mb-2 mt-8">ตัวอย่าง 8 แถวแรก</h2>
        <ul class="card divide-y divide-line overflow-hidden">
          <li v-for="r in rows.slice(0, 8)" :key="r.line" class="flex items-center justify-between gap-4 px-4 py-2.5" :class="['invalid', 'other'].includes(status(r)) ? 'opacity-50' : ''">
            <div class="min-w-0">
              <div class="truncate text-sm">{{ r.detail || '—' }}</div>
              <div class="truncate text-xs text-muted">
                {{ r.occurredAt ? formatDate(r.occurredAt) : 'วันที่ไม่ถูกต้อง' }} · {{ r.category || 'อื่นๆ' }} · {{ r.payor }}
                <template v-if="status(r) === 'partner'"> · ส่วนเรา {{ formatMoney(r.owed) }}</template>
                <template v-else-if="r.owed"> · คืน {{ formatMoney(r.owed) }}</template>
              </div>
            </div>
            <div class="num shrink-0 text-sm">{{ Number.isNaN(r.cost) ? '?' : formatMoney(r.cost) }}</div>
          </li>
        </ul>
      </template>
    </template>
  </div>
</template>
