<script setup lang="ts">
import { Activity, Check, CheckCheck, Info, MapPinned, Users } from "@lucide/vue";
import type { Scenario } from "../model";

defineProps<{ scenario: Scenario }>();
</script>

<template>
  <div class="section-layout">
    <aside class="section-sidebar">
      <span class="eyebrow">Service</span>
      <h1>Known issues</h1>
      <nav aria-label="Issue sections">
        <button class="active" type="button"><Activity aria-hidden="true" />Current</button>
        <button type="button"><CheckCheck aria-hidden="true" />Resolved</button>
        <button type="button"><Info aria-hidden="true" />How this works</button>
      </nav>
    </aside>
    <section class="section-content issues-screen">
      <div class="content-heading"><div><span class="eyebrow">Status</span><h1>Known issues</h1><p>Check here when a game update affects the launcher or optional Tools.</p></div><span class="last-checked">Last checked 10:52</span></div>
      <div class="status-metrics">
        <article><span>Guild Wars</span><strong class="good-text">Playable</strong></article>
        <article><span>Optional Tools</span><strong>{{ scenario === "degraded" ? "Some unavailable" : "Available" }}</strong></article>
        <article><span>Launcher</span><strong>{{ scenario === "offline" ? "Offline" : "Online" }}</strong></article>
      </div>
      <div class="issue-list">
        <template v-if="scenario === 'degraded'">
          <article class="issue-card">
            <MapPinned aria-hidden="true" />
            <div><h2>Quick Travel is temporarily unavailable</h2><p>Your saved destinations are safe. We are checking Quick Travel after the latest game update.</p></div>
            <span class="pill warning">Checking</span>
          </article>
          <article class="issue-card">
            <Users aria-hidden="true" />
            <div><h2>Apply teams is temporarily unavailable</h2><p>You can still edit, import, and export builds and teams.</p></div>
            <span class="pill warning">Checking</span>
          </article>
        </template>
        <article v-else class="empty-status">
          <span class="empty-icon"><Check aria-hidden="true" /></span>
          <h2>No known issues</h2>
          <p>Guild Wars and every Tool you enabled are available.</p>
        </article>
      </div>
      <p class="prototype-note">Example status for this prototype. There is no current incident.</p>
    </section>
  </div>
</template>
