import { createApp } from 'vue';
import App from './App.vue';
import { createRouter, createWebHistory } from 'vue-router';

createApp(App)
  .use(
    createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', component: () => import('./OrderPage.vue') },
        { path: '/orders/:id', component: () => import('./OrderPage.vue') },
      ],
    }),
  )
  .mount('#app');
