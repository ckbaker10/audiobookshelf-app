import { defineConfig } from 'vitest/config'
import vue2 from '@vitejs/plugin-vue2'
import path from 'path'

export default defineConfig({
  plugins: [vue2()],
  resolve: {
    // Nuxt resolves `import X from '@/components/cards/LazyBookCard'` without the extension.
    // Vite does not do that for .vue unless told to, and the app imports components both ways.
    extensions: ['.mjs', '.js', '.json', '.vue'],
    alias: {
      // Nuxt resolves both of these to the project root. Components import as '@/mixins/...'
      // and '~/components/...' interchangeably, so both have to work here or half the imports
      // fail depending on which convention the file happened to use.
      '@': path.resolve(__dirname),
      '~': path.resolve(__dirname)
    }
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.spec.js'],
    // Fail rather than pass when a test leaves an unhandled rejection behind. The defect these
    // tests were written for is a swallowed rejection, so a runner that ignores them would be
    // the wrong tool for this codebase.
    dangerouslyIgnoreUnhandledErrors: false,
    globals: false,
    restoreMocks: true
  }
})
