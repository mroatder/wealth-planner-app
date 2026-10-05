<script setup>
definePageMeta({ layout: 'auth' });

const supabase = useSupabaseClient();
const user = useSupabaseUser();

const mode = ref('login'); // 'login' | 'register'
const email = ref('');
const password = ref('');
const error = ref('');
const info = ref('');
const loading = ref(false);

watch(user, (u) => { if (u) navigateTo('/'); }, { immediate: true });

async function submit() {
  error.value = info.value = '';
  loading.value = true;
  const { error: err } = mode.value === 'login'
    ? await supabase.auth.signInWithPassword({ email: email.value, password: password.value })
    : await supabase.auth.signUp({ email: email.value, password: password.value });
  loading.value = false;
  if (err) error.value = err.message;
  else if (mode.value === 'register') info.value = 'สมัครสำเร็จ หากเปิดการยืนยันอีเมลไว้ กรุณาตรวจสอบกล่องจดหมาย';
}
</script>

<template>
  <h1 class="mb-5 text-xl font-semibold tracking-tight">{{ mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก' }}</h1>
  <form class="space-y-4" @submit.prevent="submit">
    <div>
      <label class="label" for="email">อีเมล</label>
      <input id="email" v-model="email" type="email" required autocomplete="email" class="field" />
    </div>
    <div>
      <label class="label" for="password">รหัสผ่าน</label>
      <input id="password" v-model="password" type="password" required minlength="6"
             :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" class="field" />
    </div>
    <p v-if="error" class="text-sm text-expense">{{ error }}</p>
    <p v-if="info" class="text-sm text-income">{{ info }}</p>
    <button :disabled="loading" class="btn btn-primary w-full">
      {{ mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก' }}
    </button>
  </form>
  <button type="button" class="mt-4 w-full text-center text-sm text-accent" @click="mode = mode === 'login' ? 'register' : 'login'">
    {{ mode === 'login' ? 'ยังไม่มีบัญชี? สมัครสมาชิก' : 'มีบัญชีแล้ว? เข้าสู่ระบบ' }}
  </button>
</template>
