<script setup lang="ts">
const paths = [
  { number: '01', label: 'ORIENTATION', title: '从快速开始', description: '先建立产品模型，再进入协议和实现细节。', link: '/zh-CN/guide/' },
  { number: '02', label: 'CONTRACTS', title: '浏览规格文档', description: '按产品、架构、运行时、UX、安全和插件领域深入。', link: '/zh-CN/spec/' },
  { number: '03', label: 'CONTEXT', title: '查看架构决策', description: '理解每个重要边界背后的约束和取舍。', link: '/zh-CN/adr/' },
]

const contributorLinks = [
  { title: '开发你的第一个插件', description: '包格式、API、安全、生命周期和开发流程。', link: '/plugin-development' },
  { title: '追踪一次请求', description: 'Renderer、Electron、pi sidecar、Rust host 和 SQLite 如何协作。', link: '/spec/02-architecture/01-architecture' },
  { title: '带着信心交付', description: '验收标准、E2E 场景、变更清单和发布手册。', link: '/spec/06-delivery/04-e2e-test-plan' },
]
</script>

<template>
<div class="home-modules">
  <div class="home-section home-section--overview" aria-labelledby="home-overview-title-zh">
    <div class="home-section__intro">
      <p class="home-eyebrow">为贡献者准备的文档</p>
      <h2 id="home-overview-title-zh">用一条清晰路径读懂不断增长的代码库。</h2>
      <p>PI-Desktop 用一套源事实记录产品行为、运行时契约和架构决策。按你需要的深度进入，然后继续前进。</p>
    </div>
    <div class="home-paths" role="navigation" aria-label="文档阅读路径">
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

  <div class="home-section home-section--status" aria-labelledby="home-status-title-zh">
    <div class="home-section__heading">
      <p class="home-eyebrow">当前实现快照</p>
      <h2 id="home-status-title-zh">这套文档描述的当前版本线。</h2>
    </div>
    <div class="home-status" role="list">
      <div role="listitem"><span>当前应用版本线</span><strong>0.5.8</strong></div>
      <div role="listitem"><span>Host wire protocol</span><strong>v9</strong></div>
      <div role="listitem"><span>存储 schema</span><strong>v11</strong></div>
      <div role="listitem"><span>文档源语言</span><strong>EN / 中文</strong></div>
    </div>
  </div>

  <div class="home-section home-section--contributors" aria-labelledby="home-contributors-title-zh">
    <div class="home-section__intro">
      <p class="home-eyebrow">适合贡献者继续阅读</p>
      <h2 id="home-contributors-title-zh">从认识产品到真正开始改代码。</h2>
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
