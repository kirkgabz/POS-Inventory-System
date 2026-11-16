export type Role = 'admin' | 'staff';

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: Role;
  can_manage_products: boolean;
  is_active: boolean;
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
  price: number;
  cost: number;
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
  created_at: string;
  cashier?: { full_name: string } | null;
  sale_items?: SaleItem[];
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string | null;
  name: string;
  unit_price: number;
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
