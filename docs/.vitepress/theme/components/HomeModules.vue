<script setup lang="ts">
const paths = [
  {
    number: '01',
    label: 'ORIENTATION',
    title: 'Start with the guide',
    description: 'Build the product model before opening a protocol or implementation file.',
    link: '/guide/',
  },
  {
    number: '02',
    label: 'CONTRACTS',
    title: 'Explore specifications',
    description: 'Move from product scope to architecture, runtime, UX, security, and plugins.',
    link: '/spec/README',
  },
  {
    number: '03',
    label: 'CONTEXT',
    title: 'Review decisions',
    description: 'Understand the constraints and trade-offs behind each important boundary.',
    link: '/adr/README',
  },
]

const contributorLinks = [
  { title: 'Build your first plugin', description: 'Package, API, security, lifecycle, and authoring workflow.', link: '/plugin-development' },
  { title: 'Trace a request', description: 'Renderer, Electron orchestration, pi sidecar, Rust host, and SQLite.', link: '/spec/02-architecture/01-architecture' },
  { title: 'Ship with confidence', description: 'Acceptance criteria, E2E scenarios, change checklist, and release runbook.', link: '/spec/06-delivery/04-e2e-test-plan' },
]
</script>

<template>
<div class="home-modules">
  <div class="home-section home-section--overview" aria-labelledby="home-overview-title">
    <div class="home-section__intro">
      <p class="home-eyebrow">Read the system, not the sales pitch</p>
      <h2 id="home-overview-title">A clear path through a growing codebase.</h2>
      <p>PI-Desktop has one source of truth for product behavior, runtime contracts, and architecture decisions. Pick the depth you need and keep moving.</p>
    </div>
    <div class="home-paths" role="navigation" aria-label="Documentation paths">
      <a v-for="path in paths" :key="path.number" class="home-path" :href="path.link">
        <span class="home-path__number">{{ path.number }}</span>
        <span class="home-path__body">
          <span class="home-path__label">{{ path.label }}</span>
          <strong>{{ path.title }}</strong>
          <span>{{ path.description }}</span>
        </span>
        <span class="home-path__arrow" aria-hidden="true">↗</span>
      </a>
    </div>
  </div>

  <div class="home-section home-section--status" aria-labelledby="home-status-title">
    <div class="home-section__heading">
      <p class="home-eyebrow">Current implementation snapshot</p>
      <h2 id="home-status-title">The line this documentation describes.</h2>
    </div>
    <div class="home-status" role="list">
      <div role="listitem"><span>Application line</span><strong>0.5.8</strong></div>
      <div role="listitem"><span>Host wire protocol</span><strong>v9</strong></div>
      <div role="listitem"><span>Storage schema</span><strong>v11</strong></div>
      <div role="listitem"><span>Source languages</span><strong>EN / 中文</strong></div>
    </div>
  </div>

  <div class="home-section home-section--contributors" aria-labelledby="home-contributors-title">
    <div class="home-section__intro">
      <p class="home-eyebrow">Designed for contributors</p>
      <h2 id="home-contributors-title">Useful after the first read.</h2>
    </div>
    <div class="home-contributor-list">
      <a v-for="item in contributorLinks" :key="item.title" class="home-contributor" :href="item.link">
        <strong>{{ item.title }}</strong>
        <span>{{ item.description }}</span>
        <span class="home-contributor__arrow" aria-hidden="true">→</span>
      </a>
    </div>
  </div>
</div>
</template>
