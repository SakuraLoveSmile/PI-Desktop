<script setup lang="ts">
import { useData } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import HomeModules from './components/HomeModules.vue'
import HomeModulesZh from './components/HomeModulesZh.vue'

const { Layout } = DefaultTheme
const { frontmatter, localeIndex } = useData()
</script>

<template>
  <Layout>
    <template #home-features-after>
      <HomeModules v-if="frontmatter.layout === 'home' && localeIndex !== 'zh-CN'" />
      <HomeModulesZh v-else-if="frontmatter.layout === 'home' && localeIndex === 'zh-CN'" />
    </template>
  </Layout>
</template>
