<script setup>
const supabase = useSupabaseClient();
const route = useRoute();

// `more: true` items live in the "เพิ่มเติม" sheet on phones (the tab bar only fits five)
const nav = [
  { to: '/', label: 'ภาพรวม', icon: 'home' },
  { to: '/transactions', label: 'บันทึก', icon: 'plus' },
  { to: '/history', label: 'ประวัติ', icon: 'list' },
  { to: '/partner', label: 'ยอดค้าง', icon: 'swap' },
  { to: '/budgets', label: 'งบประมาณ', icon: 'budget', more: true },
  { to: '/wallets', label: 'กระเป๋า', icon: 'wallet', more: true },
  { to: '/goals', label: 'เป้าหมาย', icon: 'target', more: true },
  { to: '/analytics', label: 'วิเคราะห์', icon: 'chart' },
];
const tabs = nav.filter((i) => !i.more);
const moreItems = [...nav.filter((i) => i.more), { to: '/import', label: 'นำเข้าจากชีต', icon: 'list' }];

const isActive = (to) => (to === '/' ? route.path === '/' : route.path.startsWith(to));
const moreOpen = ref(false);
const moreActive = computed(() => moreItems.some((i) => isActive(i.to)));
watch(() => route.path, () => { moreOpen.value = false; });

async function signOut() {
  await supabase.auth.signOut();
  await navigateTo('/login');
}
</script>

<template>
  <div class="min-h-screen">
    <!-- Desktop sidebar -->
    <aside class="sidebar fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line px-3 pb-4 pt-6 md:flex">
      <div class="mb-5 px-2.5 text-[15px] font-semibold tracking-tight">Wealth Planner</div>
      <nav class="flex flex-1 flex-col gap-0.5">
        <NuxtLink
          v-for="item in nav" :key="item.to" :to="item.to"
          class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[14px] transition"
          :class="isActive(item.to) ? 'bg-ink/10 font-medium' : 'hover:bg-ink/5'"
        >
          <AppIcon :name="item.icon" class="h-[18px] w-[18px] text-accent" />{{ item.label }}
        </NuxtLink>
      </nav>
      <button class="rounded-md px-2.5 py-1.5 text-left text-[14px] text-muted transition hover:bg-ink/5" @click="signOut">
        ออกจากระบบ
      </button>
    </aside>

    <!-- Mobile top bar -->
    <header class="tabbar sticky top-0 z-10 flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
      <div class="text-[15px] font-semibold tracking-tight">Wealth Planner</div>
      <button class="text-[15px] text-accent" @click="signOut">ออก</button>
    </header>

    <main class="md:pl-60">
      <div class="mx-auto w-full max-w-7xl px-4 pb-28 pt-6 md:px-10 md:pb-12 md:pt-10">
        <slot />
      </div>
    </main>

    <!-- Mobile "more" sheet -->
    <div v-if="moreOpen" class="fixed inset-0 z-10 bg-black/20 md:hidden" @click="moreOpen = false"></div>
    <div
      v-if="moreOpen"
      class="card fixed inset-x-3 z-20 overflow-hidden md:hidden"
      style="bottom: calc(64px + env(safe-area-inset-bottom))"
    >
      <NuxtLink
        v-for="item in moreItems" :key="item.to" :to="item.to"
        class="flex items-center gap-3 border-b border-line px-4 py-3 text-[15px] last:border-b-0"
        :class="isActive(item.to) ? 'font-medium' : ''"
      >
        <AppIcon :name="item.icon" class="h-5 w-5 text-accent" />{{ item.label }}
      </NuxtLink>
    </div>

    <!-- Mobile tab bar -->
    <nav class="tabbar fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-line pb-[env(safe-area-inset-bottom)] md:hidden">
      <NuxtLink
        v-for="item in tabs" :key="item.to" :to="item.to"
        class="flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-medium"
        :class="isActive(item.to) ? 'text-accent' : 'text-muted'"
      >
        <AppIcon :name="item.icon" class="h-6 w-6" />{{ item.label }}
      </NuxtLink>
      <button
        class="flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-medium"
        :class="moreOpen || moreActive ? 'text-accent' : 'text-muted'"
        @click="moreOpen = !moreOpen"
      >
        <AppIcon name="more" class="h-6 w-6" />เพิ่มเติม
      </button>
    </nav>
  </div>
</template>
