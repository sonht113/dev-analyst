import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import {
  createOrders,
  money,
  statusLabels,
  orderStatuses,
  type Order,
  type OrderCommand,
} from './services/demo-data.js';
import { getOrders, saveOrder, exportOrders, probeOrders } from './services/orders.js';

function OrderDrawer({
  order,
  busy,
  readOnly,
  onClose,
  onSave,
}: {
  order: Order;
  busy: boolean;
  readOnly: boolean;
  onClose: () => void;
  onSave: (command: OrderCommand) => Promise<void>;
}) {
  const [quantity, setQuantity] = useState(order.quantity),
    [note, setNote] = useState(order.note),
    [priority, setPriority] = useState(order.priority);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    (
      container.current?.querySelector<HTMLElement>('input:not(:disabled)') ??
      container.current?.querySelector<HTMLElement>('button:not(:disabled)')
    )?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !busy) {
      event.stopPropagation();
      onClose();
    }
    if (event.key !== 'Tab') return;
    const elements = event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)',
    );
    const first = elements[0],
      last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!readOnly && order.status === 'pending' && quantity >= 1 && quantity <= 99 && !busy)
      void onSave({ action: 'update', ids: [order.id], quantity, note, priority });
  }
  return (
    <div
      className="drawer-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        ref={container}
        onKeyDown={keyboard}
      >
        <div className="drawer-head">
          <div>
            <p className="muted">注文詳細</p>
            <h2 id="drawer-title">注文 #{order.id}</h2>
          </div>
          <button type="button" aria-label="詳細を閉じる" disabled={busy} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="drawer-summary">
          <span>{order.customer}</span>
          <strong>{money(quantity * order.unitPrice)}</strong>
          <span>{order.product}</span>
          <p>
            <span className={'status ' + order.status}>{statusLabels[order.status]}</span>
          </p>
        </div>
        <form onSubmit={submit}>
          <label className="field">
            数量
            <input
              aria-label="数量"
              type="number"
              min="1"
              max="99"
              required
              value={quantity}
              disabled={busy || readOnly || order.status !== 'pending'}
              onChange={(event) => setQuantity(Number(event.target.value))}
            />
          </label>
          <label className="field">
            配送メモ
            <textarea
              aria-label="配送メモ"
              maxLength={500}
              value={note}
              disabled={busy || readOnly || order.status !== 'pending'}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={priority}
              disabled={busy || readOnly || order.status !== 'pending'}
              onChange={(event) => setPriority(event.target.checked)}
            />
            優先配送にする
          </label>
          <p className="muted">承認待ちの注文のみ編集できます。デモ内のデータはすべて架空です。</p>
          <div className="drawer-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              キャンセル
            </button>
            <button
              className="primary"
              type="submit"
              disabled={
                busy || readOnly || order.status !== 'pending' || quantity < 1 || quantity > 99
              }
            >
              {busy ? '保存中…' : '変更を保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Home() {
  const [orders, setOrders] = useState(createOrders),
    [count, setCount] = useState(0),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState('all'),
    [sort, setSort] = useState('id'),
    [page, setPage] = useState(1),
    [selectedIds, setSelectedIds] = useState<number[]>([]),
    [editing, setEditing] = useState<Order | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [failure, setFailure] = useState(false),
    [role, setRole] = useState('reviewer');
  const [activity, setActivity] = useState([
    '36件のサンプル注文を読み込みました',
    '18件の注文が確認待ちです',
    '詳細を開いてフォームとボタンの条件を確認できます',
  ]);
  const operation = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const generation = ++operation.current;
    void getOrders(false, controller.signal)
      .then((result) => {
        if (generation === operation.current) setOrders(result.orders);
      })
      .catch(() => {
        if (!controller.signal.aborted && generation === operation.current)
          setError(
            'デモAPIから読み込めませんでした。サンプルデータは表示できます。再読み込みしてください。',
          );
      });
    return () => {
      controller.abort();
      operation.current++;
    };
  }, []);
  const filtered = useMemo(
    () =>
      orders
        .filter(
          (order) =>
            (status === 'all' || order.status === status) &&
            `${order.id} ${order.customer} ${order.product}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === 'amount' ? b.quantity * b.unitPrice - a.quantity * a.unitPrice : a.id - b.id,
        ),
    [orders, status, query, sort],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 6)),
    currentPage = Math.min(page, pages),
    visible = filtered.slice((currentPage - 1) * 6, currentPage * 6);
  const selected = orders.filter((order) => selectedIds.includes(order.id));
  const canApprove =
    role === 'reviewer' &&
    selected.length > 0 &&
    selected.every((order) => order.status === 'pending') &&
    !busy;
  const pending = orders.filter((order) => order.status === 'pending').length,
    shipped = orders.filter((order) => order.status === 'shipped').length;
  const revenue = orders
    .filter((order) => order.status !== 'cancelled')
    .reduce((total, order) => total + order.quantity * order.unitPrice, 0);
  function changed() {
    setPage(1);
    setSelectedIds([]);
  }
  function toggle(id: number) {
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );
  }
  function togglePage() {
    const all = visible.every((order) => selectedIds.includes(order.id));
    setSelectedIds((ids) =>
      all
        ? ids.filter((id) => !visible.some((order) => order.id === id))
        : [...new Set([...ids, ...visible.map((order) => order.id)])],
    );
  }
  async function execute(command: OrderCommand, description: string) {
    if (busy || (command.action !== 'refresh' && role !== 'reviewer')) return;
    setBusy(true);
    setError('');
    setNotice('');
    const generation = ++operation.current;
    try {
      const result = await saveOrder(command, failure);
      if (generation !== operation.current) return;
      setOrders(result.orders);
      setSelectedIds([]);
      setEditing(null);
      setNotice(description);
      setActivity((items) => [description, ...items].slice(0, 5));
    } catch {
      if (generation === operation.current)
        setError(
          failure
            ? 'デモAPIで503エラーを再現しています。「再試行」で通常のデータを読み込めます。'
            : 'リクエストを完了できませんでした。データを再読み込みしてから再試行してください。',
        );
    } finally {
      if (generation === operation.current) setBusy(false);
    }
  }
  async function reload(force = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    if (force) setFailure(false);
    const generation = ++operation.current;
    try {
      const result = await getOrders(force ? false : failure);
      if (generation === operation.current) {
        setOrders(result.orders);
        setNotice('デモAPIのデータを同期しました。');
      }
    } catch {
      if (generation === operation.current)
        setError('デモデータを読み込めません。エラー再現を解除するか「再試行」を押してください。');
    } finally {
      if (generation === operation.current) setBusy(false);
    }
  }
  function approve() {
    if (canApprove)
      void execute(
        { action: 'approve', ids: selectedIds },
        `${selectedIds.length}件の注文を承認しました。`,
      );
  }
  function save() {
    void probeOrders().then(
      () => setNotice('注文保存APIへの接続を確認しました。'),
      () => setError('デモAPIに接続できません。もう一度同期してください。'),
    );
  }
  function exportCsv() {
    exportOrders(filtered);
  }
  return (
    <div className="demo-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">DA</span>DevAnalyst
        </div>
        <div className="workspace">
          <strong>注文管理ワークスペース</strong>日本 · テスト環境
        </div>
        <div>
          <p className="nav-label">ワークスペース</p>
          <nav aria-label="ワークスペース内の移動">
            <a className="active" href="#orders">
              <span className="nav-symbol">▤</span>注文
              <span className="count-badge">{orders.length}</span>
            </a>
            <a href="#insights">
              <span className="nav-symbol">▥</span>概要
            </a>
            <a href="#activity">
              <span className="nav-symbol">◷</span>操作履歴
            </a>
          </nav>
        </div>
        <div className="sidebar-foot">
          <strong>操作の流れを確認</strong>絞り込み → 選択 → 承認
          <br />
          サンプルデータのみを使用し、実際のアカウントは使用しません。
        </div>
      </aside>
      <main className="demo-main">
        <header className="topbar">
          <div className="breadcrumbs">
            ワークスペース <span> / </span>
            <strong>注文</strong>
          </div>
          <div className="topbar-right">
            <span className="demo-pill">● サンプルデータ</span>
            <span className="muted">日本・東京</span>
            <span className="avatar" aria-label="デモユーザー">
              HT
            </span>
          </div>
        </header>
        <section className="page-heading">
          <div>
            <h1>注文管理センター</h1>
            <p className="muted">ひとつのワークスペースで注文の確認と処理を行えます。</p>
          </div>
          <div className="heading-actions">
            <button type="button" disabled={busy} onClick={exportCsv}>
              ↓ CSVを出力
            </button>
            <button className="primary" type="button" disabled={busy} onClick={() => void reload()}>
              ↻ {busy ? '読み込み中…' : 'データを同期'}
            </button>
          </div>
        </section>
        <div className="lab">
          <strong>要素検証ラボ · REACT + VITE</strong>
          <span className="muted">要素にマウスを重ねて確認 · パネル内で操作できます</span>
          <button id="counter" type="button" onClick={() => setCount((value) => value + 1)}>
            カウント: {count}
          </button>
          {count < 5 && (
            <button id="save" disabled={count > 3 || busy} onClick={save}>
              保存
            </button>
          )}
          <a className="btn" href="#orders">
            注文一覧を見る
          </a>
        </div>
        {error && (
          <div role="alert" aria-label="デモAPIエラー" className="error-banner">
            <p>{error}</p>
            <button type="button" disabled={busy} onClick={() => void reload(true)}>
              再試行
            </button>
          </div>
        )}
        {notice && !error && (
          <div role="status" className="notice">
            ✓ {notice}
          </div>
        )}
        <section className="cards" aria-label="注文の集計">
          <article className="card kpi">
            <span className="kpi-icon">▤</span>
            <div className="kpi-title">注文総数</div>
            <div className="kpi-value">{orders.length}</div>
            <span className="kpi-note">デモセッションのサンプルデータ</span>
          </article>
          <article className="card kpi">
            <span className="kpi-icon">◷</span>
            <div className="kpi-title">承認待ち</div>
            <div className="kpi-value">{pending}</div>
            <span className="kpi-note">処理前に内容を確認してください</span>
          </article>
          <article className="card kpi">
            <span className="kpi-icon">✓</span>
            <div className="kpi-title">配送完了</div>
            <div className="kpi-value">{shipped}</div>
            <span className="kpi-note">現在の注文ステータスに基づく集計</span>
          </article>
          <article className="card kpi">
            <span className="kpi-icon">¥</span>
            <div className="kpi-title">有効な注文の合計金額</div>
            <div className="kpi-value">{money(revenue)}</div>
            <span className="kpi-note">キャンセル済みの注文を除く</span>
          </article>
        </section>
        <section className="card" id="orders" aria-labelledby="orders-title" aria-busy={busy}>
          <div className="toolbar">
            <div className="toolbar-title">
              <h2 id="orders-title">すべての注文</h2>
              <span className="count-badge">{filtered.length}</span>
            </div>
            <div className="filters">
              <label className="search">
                <input
                  aria-label="注文を検索"
                  placeholder="注文番号・顧客名・商品名で検索…"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    changed();
                  }}
                />
              </label>
              <select
                aria-label="ステータスで絞り込み"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  changed();
                }}
              >
                <option value="all">すべてのステータス</option>
                {Object.entries(statusLabels).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label="注文の並び順"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value);
                  setPage(1);
                }}
              >
                <option value="id">注文番号の昇順</option>
                <option value="amount">金額の高い順</option>
              </select>
            </div>
          </div>
          <div className="bulk">
            <span>
              {selected.length
                ? `選択中: ${selected.length} 件`
                : '承認待ちの注文を選択して一括承認を試せます。'}
            </span>
            {role !== 'reviewer' && <small>現在の権限では閲覧のみ可能です。</small>}
            <button
              className="primary small"
              type="button"
              disabled={!canApprove}
              onClick={approve}
            >
              選択した注文を承認
            </button>
          </div>
          <div className="table-scroll">
            <table aria-label="注文一覧">
              <thead>
                <tr>
                  <th>
                    <input
                      aria-label="このページの注文をすべて選択"
                      type="checkbox"
                      checked={
                        visible.length > 0 &&
                        visible.every((order) => selectedIds.includes(order.id))
                      }
                      onChange={togglePage}
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
                {visible.map((order) => (
                  <tr
                    key={order.id}
                    data-testid={'order-row-' + order.id}
                    className={selectedIds.includes(order.id) ? 'selected' : ''}
                  >
                    <td>
                      <input
                        aria-label={'注文を選択: ' + order.id}
                        type="checkbox"
                        checked={selectedIds.includes(order.id)}
                        onChange={() => toggle(order.id)}
                      />
                    </td>
                    <td>
                      <button
                        className="small quiet order-number"
                        type="button"
                        onClick={() => setEditing(order)}
                      >
                        #{order.id}
                      </button>
                      <p className="muted">
                        {order.product}
                        {order.priority && <span className="priority">● 優先</span>}
                      </p>
                    </td>
                    <td>
                      <div className="customer">
                        <span className="avatar">{order.customer.slice(0, 1)}</span>
                        <div>
                          <strong>{order.customer}</strong>
                          <small>サンプル顧客 · 日本</small>
                        </div>
                      </div>
                    </td>
                    <td className="muted">{order.date}</td>
                    <td>
                      <strong>{money(order.quantity * order.unitPrice)}</strong>
                      <p className="muted">{order.quantity} 点</p>
                    </td>
                    <td>
                      <span className={'status ' + order.status}>{statusLabels[order.status]}</span>
                    </td>
                    <td>
                      <button
                        className="small"
                        type="button"
                        aria-label={'注文の詳細: ' + order.id}
                        onClick={() => setEditing(order)}
                      >
                        詳細 ↗
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && (
              <div className="empty-state">
                <strong>該当する注文がありません</strong>
                <p>別のキーワードやステータスで検索してください。</p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setStatus('all');
                    changed();
                  }}
                >
                  絞り込みを解除
                </button>
              </div>
            )}
          </div>
          <div className="pagination">
            <span>
              表示 {visible.length ? (currentPage - 1) * 6 + 1 : 0}–
              {Math.min(currentPage * 6, filtered.length)} / {filtered.length} 件
            </span>
            <div className="pagination-controls">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                ← 前へ
              </button>
              <span>
                ページ {currentPage} / {pages}
              </span>
              <button
                type="button"
                disabled={currentPage >= pages}
                onClick={() => setPage((value) => value + 1)}
              >
                次へ →
              </button>
            </div>
          </div>
          <div className="demo-options">
            <label>
              デモの権限
              <select
                aria-label="デモの権限"
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                <option value="reviewer">承認担当者 · 承認可能</option>
                <option value="viewer">閲覧者 · 閲覧のみ</option>
              </select>
            </label>
            <label>
              <input
                aria-label="APIエラーを再現"
                type="checkbox"
                checked={failure}
                onChange={(event) => setFailure(event.target.checked)}
              />
              APIエラー（503）を再現
            </label>
            <button
              className="small quiet"
              type="button"
              disabled={busy || role !== 'reviewer'}
              onClick={() =>
                void execute({ action: 'reset' }, '36件のサンプル注文を復元しました。')
              }
            >
              デモをリセット
            </button>
            {busy && (
              <span className="loading" role="status">
                処理中…
              </span>
            )}
          </div>
        </section>
        <div className="bottom-grid">
          <section className="card" id="insights">
            <div className="section-heading">
              <h2>ステータス別の内訳</h2>
              <span className="muted">デモデータから集計</span>
            </div>
            <div className="pipeline">
              {orderStatuses.map((value) => {
                const total = orders.filter((order) => order.status === value).length;
                return (
                  <div className="pipeline-row" key={value}>
                    <span>{statusLabels[value]}</span>
                    <div className="bar-track">
                      <span
                        className="bar-fill"
                        style={{ width: (total / orders.length) * 100 + '%' }}
                      />
                    </div>
                    <strong>{total}</strong>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="card" id="activity">
            <div className="section-heading">
              <h2>最近の操作</h2>
              <span className="muted">現在のセッション</span>
            </div>
            <div className="activity">
              {activity.map((item, index) => (
                <article className="activity-item" key={index + item}>
                  <span className="activity-dot" />
                  <div>
                    {item}
                    <small>架空のデータ · ディスクへの保存なし</small>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
        <p className="footer-note">
          DevAnalyst ·
          架空の注文データと同一オリジンのAPIを使用し、状態はメモリ内で管理します。外部サービスには接続しません。
        </p>
      </main>
      {editing && (
        <OrderDrawer
          key={editing.id}
          order={editing}
          busy={busy}
          readOnly={role !== 'reviewer'}
          onClose={() => setEditing(null)}
          onSave={(command) => execute(command, `注文 #${editing.id}を更新しました。`)}
        />
      )}
    </div>
  );
}
