<template>
  <div
    class="flex min-h-screen items-center justify-center px-5 py-10"
    style="min-height: 100dvh; background: radial-gradient(120% 80% at 50% 0%, rgb(var(--c-accent) / 0.14), transparent 60%), rgb(var(--c-paper))"
  >
    <div class="w-full max-w-sm">
      <div class="mb-8 flex flex-col items-center text-center">
        <img src="/icons/icon-192.png" alt="" class="h-20 w-20 rounded-[22px] shadow-card" />
        <div class="mt-4 text-[26px] font-bold tracking-tight">Wealth Planner</div>
        <div class="mt-1 text-sm text-muted">บันทึกรายรับรายจ่าย วางแผนเงินของเรา</div>
      </div>
      <div class="card p-6 sm:p-7">
        <slot />
      </div>
    </div>
  </div>
</template>
