export type Role = 'admin' | 'staff';

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: Role;
  can_manage_products: boolean;
  is_active: boolean;
  /** brand-new Google user who has not finished sign-up yet */
  setup_pending?: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  barcode: string | null;
  word_code: string | null;
  is_custom: boolean;
  image_url: string | null;
  price: number;
  cost: number;
  /** pieces in one wholesale pack (null = bought per piece) */
  pack_size?: number | null;
  stock: number;
  low_stock_threshold: number;
  unit: string;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ProductInput = Omit<
  Product,
  'id' | 'created_by' | 'updated_by' | 'created_at' | 'updated_at'
>;

export interface Sale {
  id: string;
  receipt_no: string;
  cashier_id: string | null;
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  change_due: number;
  payment_method: string;
  payment_account: string | null;
  payment_ref: string | null;
  created_at: string;
  /** name/role of whoever took the order, saved on the sale */
  cashier_name?: string | null;
  cashier_role?: string | null;
  cashier?: { full_name: string; role?: string } | null;
  sale_items?: SaleItem[];
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string | null;
  name: string;
  unit_price: number;
  unit_cost: number;
  quantity: number;
  line_total: number;
}

export type NotificationType =
  | 'product_added'
  | 'price_updated'
  | 'product_updated'
  | 'stock_adjusted'
  | 'staff_signup';

export interface AppNotification {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  actor_name: string | null;
  type: NotificationType;
  title: string;
  message: string;
  product_id: string | null;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export interface CartLine {
  product: Product;
  quantity: number;
}

export interface SaleResult {
  sale_id: string;
  receipt_no: string;
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  change: number;
}

export type PaymentKind = 'ewallet' | 'bank';

export interface PaymentAccount {
  id: string;
  kind: PaymentKind;
  provider: string;
  account_name: string;
  account_number: string | null;
  qr_url: string | null;
  is_active: boolean;
  created_at: string;
}

export interface StaffInvite {
  id: string;
  code: string;
  invited_name: string | null;
  email: string | null;
  created_by: string | null;
  expires_at: string;
  used_by: string | null;
  used_at: string | null;
  revoked: boolean;
  created_at: string;
  used_profile?: { full_name: string; email: string | null } | null;
}

export interface Attendance {
  id: string;
  user_id: string;
  work_date: string;
  time_in: string;
  time_out: string | null;
  method_in: 'manual' | 'face';
  method_out: 'manual' | 'face' | 'owner' | null;
  distance_in: number | null;
  distance_out: number | null;
  note: string | null;
  edited_by: string | null;
  created_at: string;
  person?: { full_name: string; email: string | null } | null;
}

export interface DtrStatus {
  face_in: boolean;
  face_out: boolean;
  face_required: boolean;
  threshold: number;
  timezone: string;
  enrolled: boolean;
  server_now: string;
  open: Attendance | null;
}

export type ActivityAction = 'added' | 'price' | 'edited' | 'restock' | 'stock_in' | 'stock_out' | 'deleted';

export interface ProductActivity {
  id: string;
  product_id: string | null;
  product_name: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string | null;
  action: ActivityAction;
  stock_change: number | null;
  changes: Record<string, unknown>;
  note: string | null;
  created_at: string;
}
