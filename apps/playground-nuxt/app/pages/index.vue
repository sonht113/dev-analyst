<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';

import {
  createOrders,
  money,
  statusLabels,
  orderStatuses,
  type Order,
  type OrderCommand,
} from '../services/demo-data.js';
import { getOrders, saveOrder, exportOrders } from '../services/orders.js';

const orders = ref(createOrders()),
  count = ref(0),
  query = ref(''),
  status = ref('all'),
  sort = ref('id'),
  page = ref(1),
  selectedIds = ref<number[]>([]),
  editing = ref<Order | null>(null),
  busy = ref(false),
  error = ref(''),
  notice = ref(''),
  failure = ref(false),
  role = ref('reviewer');
const activity = ref([
  '36件のサンプル注文を読み込みました',
  '18件の注文が確認待ちです',
  '詳細を開いてフォームとボタンの条件を確認できます',
]);

const quantity = ref(1),
  note = ref(''),
  priority = ref(false),
  drawer = ref<HTMLDivElement | null>(null);
let operation = 0,
  previousFocus: Element | null = null;
const controller = new AbortController();
onMounted(() => {
  const generation = ++operation;
  void getOrders(false, controller.signal)
    .then((result) => {
      if (generation === operation) orders.value = result.orders;
    })
    .catch(() => {
      if (!controller.signal.aborted && generation === operation)
        error.value =
          'デモAPIから読み込めませんでした。サンプルデータは表示できます。再読み込みしてください。';
    });
});
onUnmounted(() => {
  controller.abort();
  operation++;
});
watch([query, status], () => {
  page.value = 1;
  selectedIds.value = [];
});
const filtered = computed(() =>
  orders.value
    .filter(
      (order) =>
        (status.value === 'all' || order.status === status.value) &&
        `${order.id} ${order.customer} ${order.product}`
          .toLowerCase()
          .includes(query.value.toLowerCase()),
    )
    .sort((a, b) =>
      sort.value === 'amount' ? b.quantity * b.unitPrice - a.quantity * a.unitPrice : a.id - b.id,
    ),
);
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 6))),
  currentPage = computed(() => Math.min(page.value, pages.value)),
  visibleOrders = computed(() =>
    filtered.value.slice((currentPage.value - 1) * 6, currentPage.value * 6),
  );
const selected = computed(() =>
  orders.value.filter((order) => selectedIds.value.includes(order.id)),
);
const canApprove = computed(
  () =>
    role.value === 'reviewer' &&
    selected.value.length > 0 &&
    selected.value.every((order) => order.status === 'pending') &&
    !busy.value,
);
const pending = computed(() => orders.value.filter((order) => order.status === 'pending').length),
  shipped = computed(() => orders.value.filter((order) => order.status === 'shipped').length);
const revenue = computed(() =>
  orders.value
    .filter((order) => order.status !== 'cancelled')
    .reduce((total, order) => total + order.quantity * order.unitPrice, 0),
);
const allSelected = computed(
  () =>
    visibleOrders.value.length > 0 &&
    visibleOrders.value.every((order) => selectedIds.value.includes(order.id)),
);
function toggle(id: number) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((value) => value !== id)
    : [...selectedIds.value, id];
}
function togglePage() {
  selectedIds.value = allSelected.value
    ? selectedIds.value.filter((id) => !visibleOrders.value.some((order) => order.id === id))
    : [...new Set([...selectedIds.value, ...visibleOrders.value.map((order) => order.id)])];
}
async function execute(command: OrderCommand, description: string) {
  if (busy.value || (command.action !== 'refresh' && role.value !== 'reviewer')) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  const generation = ++operation;
  try {
    const result = await saveOrder(command, failure.value);
    if (generation !== operation) return;
    orders.value = result.orders;
    selectedIds.value = [];
    await closeOrder();
    notice.value = description;
    activity.value = [description, ...activity.value].slice(0, 5);
  } catch {
    if (generation === operation)
      error.value = failure.value
        ? 'デモAPIで503エラーを再現しています。「再試行」で通常のデータを読み込めます。'
        : 'リクエストを完了できませんでした。データを再読み込みしてから再試行してください。';
  } finally {
    if (generation === operation) busy.value = false;
  }
}
async function reload(force = false) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  if (force) failure.value = false;
  const generation = ++operation;
  try {
    const result = await getOrders(force ? false : failure.value);
    if (generation === operation) {
      orders.value = result.orders;
      notice.value = 'デモAPIのデータを同期しました。';
    }
  } catch {
    if (generation === operation)
      error.value =
        'デモデータを読み込めません。エラー再現を解除するか「再試行」を押してください。';
  } finally {
    if (generation === operation) busy.value = false;
  }
}
function approve() {
  if (canApprove.value)
    void execute(
      { action: 'approve', ids: selectedIds.value },
      `${selectedIds.value.length}件の注文を承認しました。`,
    );
}
function save() {
  void execute({ action: 'refresh' }, '注文保存APIへの接続を確認しました。');
}
async function openOrder(order: Order) {
  previousFocus = document.activeElement;
  editing.value = order;
  quantity.value = order.quantity;
  priority.value = order.priority;
  note.value = order.note;
  await nextTick();
  (
    drawer.value?.querySelector<HTMLElement>('input:not(:disabled)') ??
    drawer.value?.querySelector<HTMLElement>('button:not(:disabled)')
  )?.focus();
}
async function closeOrder() {
  editing.value = null;
  await nextTick();
  if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  previousFocus = null;
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape' && !busy.value) {
    event.stopPropagation();
    void closeOrder();
  }
  if (event.key !== 'Tab') return;
  const nodes = drawer.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)',
    ),
    first = nodes?.[0],
    last = nodes?.[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
function submit() {
  if (
    role.value === 'reviewer' &&
    editing.value?.status === 'pending' &&
    quantity.value >= 1 &&
    quantity.value <= 99 &&
    !busy.value
  )
    void execute(
      {
        action: 'update',
        ids: [editing.value.id],
        quantity: quantity.value,
        note: note.value,
        priority: priority.value,
      },
      `注文 #${editing.value.id}を更新しました。`,
    );
}
function exportCsv() {
  exportOrders(filtered.value);
}
function total(value: string) {
  return orders.value.filter((order) => order.status === value).length;
}
</script>
<template>
  <div>
    <section class="page-heading">
      <div>
        <h1>注文管理センター</h1>
        <p class="muted">ひとつのワークスペースで注文の確認と処理を行えます。</p>
      </div>
      <div class="heading-actions">
        <button type="button" :disabled="busy" @click="exportCsv">↓ CSVを出力</button
        ><button class="primary" type="button" :disabled="busy" @click="reload()">
          ↻ {{ busy ? '読み込み中…' : 'データを同期' }}
        </button>
      </div>
    </section>
    <div class="lab">
      <strong>要素検証ラボ · NUXT + VUE</strong
      ><span class="muted">要素にマウスを重ねて確認 · パネル内で操作できます</span
      ><button id="save" :disabled="count > 3 || busy" @click.stop="save">保存</button>
    </div>
    <div v-if="error" role="alert" aria-label="デモAPIエラー" class="error-banner">
      <p>{{ error }}</p>
      <button type="button" :disabled="busy" @click="reload(true)">再試行</button>
    </div>
    <div v-if="notice && !error" role="status" class="notice">✓ {{ notice }}</div>
    <section class="cards" aria-label="注文の集計">
      <article class="card kpi">
        <span class="kpi-icon">▤</span>
        <div class="kpi-title">注文総数</div>
        <div class="kpi-value">{{ orders.length }}</div>
        <span class="kpi-note">デモセッションのサンプルデータ</span>
      </article>
      <article class="card kpi">
        <span class="kpi-icon">◷</span>
        <div class="kpi-title">承認待ち</div>
        <div class="kpi-value">{{ pending }}</div>
        <span class="kpi-note">処理前に内容を確認してください</span>
      </article>
      <article class="card kpi">
        <span class="kpi-icon">✓</span>
        <div class="kpi-title">配送完了</div>
        <div class="kpi-value">{{ shipped }}</div>
        <span class="kpi-note">現在の注文ステータスに基づく集計</span>
      </article>
      <article class="card kpi">
        <span class="kpi-icon">¥</span>
        <div class="kpi-title">有効な注文の合計金額</div>
        <div class="kpi-value">{{ money(revenue) }}</div>
        <span class="kpi-note">キャンセル済みの注文を除く</span>
      </article>
    </section>

    <section class="card" id="orders" aria-labelledby="orders-title" :aria-busy="busy">
      <div class="toolbar">
        <div class="toolbar-title">
          <h2 id="orders-title">すべての注文</h2>
          <span class="count-badge">{{ filtered.length }}</span>
        </div>
        <div class="filters">
          <label class="search"
            ><input
              aria-label="注文を検索"
              placeholder="注文番号・顧客名・商品名で検索…"
              v-model="query" /></label
          ><select aria-label="ステータスで絞り込み" v-model="status">
            <option value="all">すべてのステータス</option>
            <option v-for="value in orderStatuses" :key="value" :value="value">
              {{ statusLabels[value] }}
            </option></select
          ><select aria-label="注文の並び順" v-model="sort" @change="page = 1">
            <option value="id">注文番号の昇順</option>
            <option value="amount">金額の高い順</option>
          </select>
        </div>
      </div>
      <div class="bulk">
        <span>{{
          selected.length
            ? `選択中: ${selected.length} 件`
            : '承認待ちの注文を選択して一括承認を試せます。'
        }}</span
        ><small v-if="role !== 'reviewer'">現在の権限では閲覧のみ可能です。</small
        ><button class="primary small" type="button" :disabled="!canApprove" @click="approve">
          選択した注文を承認
        </button>
      </div>
      <div class="table-scroll">
        <table aria-label="注文一覧">
          <thead>
            <tr>
              <th>
                <input
                  aria-label="このページの注文をすべて選択"
                  type="checkbox"
                  :checked="allSelected"
                  @change="togglePage"
                />
              </th>
              <th>注文</th>
              <th>顧客</th>
              <th>作成日</th>
              <th>金額</th>
              <th>ステータス</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="order in visibleOrders"
              :key="order.id"
              :data-testid="'order-row-' + order.id"
              :class="{ selected: selectedIds.includes(order.id) }"
            >
              <td>
                <input
                  :aria-label="'注文を選択: ' + order.id"
                  type="checkbox"
                  :checked="selectedIds.includes(order.id)"
                  @change="toggle(order.id)"
                />
              </td>
              <td>
                <button class="small quiet order-number" type="button" @click="openOrder(order)">
                  #{{ order.id }}
                </button>
                <p class="muted">
                  {{ order.product }}<span v-if="order.priority" class="priority">● 優先</span>
                </p>
              </td>
              <td>
                <div class="customer">
                  <span class="avatar">{{ order.customer.slice(0, 1) }}</span>
                  <div>
                    <strong>{{ order.customer }}</strong
                    ><small>サンプル顧客 · 日本</small>
                  </div>
                </div>
              </td>
              <td class="muted">{{ order.date }}</td>
              <td>
                <strong>{{ money(order.quantity * order.unitPrice) }}</strong>
                <p class="muted">{{ order.quantity }} 点</p>
              </td>
              <td>
                <span :class="'status ' + order.status">{{ statusLabels[order.status] }}</span>
              </td>
              <td>
                <button
                  class="small"
                  type="button"
                  :aria-label="'注文の詳細: ' + order.id"
                  @click="openOrder(order)"
                >
                  詳細 ↗
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!visibleOrders.length" class="empty-state">
          <strong>該当する注文がありません</strong>
          <p>別のキーワードやステータスで検索してください。</p>
          <button
            type="button"
            @click="
              query = '';
              status = 'all';
            "
          >
            絞り込みを解除
          </button>
        </div>
      </div>
      <div class="pagination">
        <span
          >表示 {{ visibleOrders.length ? (currentPage - 1) * 6 + 1 : 0 }}–{{
            Math.min(currentPage * 6, filtered.length)
          }}
          / {{ filtered.length }} 件</span
        >
        <div class="pagination-controls">
          <button type="button" :disabled="currentPage <= 1" @click="page--">← 前へ</button
          ><span>ページ {{ currentPage }} / {{ pages }}</span
          ><button type="button" :disabled="currentPage >= pages" @click="page++">次へ →</button>
        </div>
      </div>
      <div class="demo-options">
        <label
          >デモの権限<select aria-label="デモの権限" v-model="role">
            <option value="reviewer">承認担当者 · 承認可能</option>
            <option value="viewer">閲覧者 · 閲覧のみ</option>
          </select></label
        ><label
          ><input
            aria-label="APIエラーを再現"
            type="checkbox"
            v-model="failure"
          />次のリクエストでAPIエラーを再現</label
        ><button
          class="small quiet"
          type="button"
          :disabled="busy || role !== 'reviewer'"
          @click="execute({ action: 'reset' }, '36件のサンプル注文を復元しました。')"
        >
          デモをリセット</button
        ><span v-if="busy" class="loading" role="status">処理中…</span>
      </div>
    </section>
    <div class="bottom-grid">
      <section class="card" id="insights">
        <div class="section-heading">
          <h2>ステータス別の内訳</h2>
          <span class="muted">デモデータから集計</span>
        </div>
        <div class="pipeline">
          <div v-for="value in orderStatuses" :key="value" class="pipeline-row">
            <span>{{ statusLabels[value] }}</span>
            <div class="bar-track">
              <span
                class="bar-fill"
                :style="{ width: (total(value) / orders.length) * 100 + '%' }"
              />
            </div>
            <strong>{{ total(value) }}</strong>
          </div>
        </div>
      </section>
      <section class="card" id="activity">
        <div class="section-heading">
          <h2>最近の操作</h2>
          <span class="muted">現在のセッション</span>
        </div>
        <div class="activity">
          <article v-for="(item, index) in activity" :key="index + item" class="activity-item">
            <span class="activity-dot" />
            <div>{{ item }}<small>架空のデータ · ディスクへの保存なし</small></div>
          </article>
        </div>
      </section>
    </div>

    <p class="footer-note">
      DevAnalyst ·
      架空の注文データと同一オリジンのAPIを使用し、状態はメモリ内で管理します。外部サービスには接続しません。
    </p>
    <div v-if="editing" class="drawer-backdrop" @click.self="!busy && closeOrder()">
      <div
        class="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        ref="drawer"
        @keydown="keyboard"
      >
        <div class="drawer-head">
          <div>
            <p class="muted">注文詳細</p>
            <h2 id="drawer-title">注文 #{{ editing.id }}</h2>
          </div>
          <button type="button" aria-label="詳細を閉じる" :disabled="busy" @click="closeOrder">
            ×
          </button>
        </div>
        <div class="drawer-summary">
          <span>{{ editing.customer }}</span
          ><strong>{{ money(quantity * editing.unitPrice) }}</strong
          ><span>{{ editing.product }}</span>
          <p>
            <span :class="'status ' + editing.status">{{ statusLabels[editing.status] }}</span>
          </p>
        </div>
        <form @submit.prevent="submit">
          <label class="field"
            >数量<input
              aria-label="数量"
              type="number"
              min="1"
              max="99"
              required
              v-model.number="quantity"
              :disabled="busy || role !== 'reviewer' || editing.status !== 'pending'" /></label
          ><label class="field"
            >配送メモ<textarea
              aria-label="配送メモ"
              maxlength="500"
              v-model="note"
              :disabled="busy || role !== 'reviewer' || editing.status !== 'pending'"
            /></label
          ><label class="check"
            ><input
              type="checkbox"
              v-model="priority"
              :disabled="busy || role !== 'reviewer' || editing.status !== 'pending'"
            />優先配送にする</label
          >
          <p class="muted">承認待ちの注文のみ編集できます。デモ内のデータはすべて架空です。</p>
          <div class="drawer-actions">
            <button type="button" :disabled="busy" @click="closeOrder">キャンセル</button
            ><button
              class="primary"
              type="submit"
              :disabled="
                busy ||
                role !== 'reviewer' ||
                editing.status !== 'pending' ||
                quantity < 1 ||
                quantity > 99
              "
            >
              {{ busy ? '保存中…' : '変更を保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
