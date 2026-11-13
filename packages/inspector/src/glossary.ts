/** Local lexical candidates, never claims about application behavior. Original text is never changed. */
const terms: Readonly<Record<string, string>> = {
  保存: 'Lưu',
  キャンセル: 'Hủy',
  取消: 'Hủy',
  削除: 'Xóa',
  編集: 'Chỉnh sửa',
  検索: 'Tìm kiếm',
  確認: 'Xác nhận',
  送信: 'Gửi',
  登録: 'Đăng ký',
  更新: 'Cập nhật',
  閉じる: 'Đóng',
  戻る: 'Quay lại',
  次へ: 'Tiếp theo',
  前へ: 'Trước',
  一覧: 'Danh sách',
  詳細: 'Chi tiết',
  設定: 'Cài đặt',
  ログイン: 'Đăng nhập',
  ログアウト: 'Đăng xuất',
  追加: 'Thêm',
  作成: 'Tạo',
  表示: 'Hiển thị',
  非表示: 'Ẩn',
  開く: 'Mở',
  選択: 'Chọn',
  すべて: 'Tất cả',
  名前: 'Tên',
  メール: 'Email',
  必須: 'Bắt buộc',
  注文: 'Đơn hàng',
  ユーザー: 'Người dùng',
  ダウンロード: 'Tải xuống',
  アップロード: 'Tải lên',
  読み込み中: 'Đang tải',
  '読み込み中…': 'Đang tải…',
  保存する: 'Lưu',
  変更を保存: 'Lưu thay đổi',
};
export function glossaryTranslation(original: string): string | null {
  const key = original.replace(/\s+/g, ' ').trim();
  return Object.hasOwn(terms, key) ? (terms[key] ?? null) : null;
}
export function normalizedOriginal(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 512);
}
