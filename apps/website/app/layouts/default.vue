<template>
  <div class="flex min-h-screen flex-col">
    <SiteNav />
    <main class="flex-1">
      <slot />
    </main>
    <SiteFooter />
  </div>
</template>
