<template>
  <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
    <span class="h-px bg-bordergold opacity-65" aria-hidden="true" />
    <h2 class="text-center text-sm tracking-[0.15em] text-gold-400 uppercase">
      <slot />
    </h2>
    <span class="h-px bg-bordergold opacity-65" aria-hidden="true" />
  </div>
</template>
