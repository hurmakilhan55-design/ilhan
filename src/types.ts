export type ServiceStatus = 
  | 'PENDING' 
  | 'ASSIGNED'
  | 'IN_PROGRESS' 
  | 'COMPLETED' 
  | 'WAITING_PART'
  | 'REVISIT_REQUIRED'
  | 'CANCELLED';

export type ServiceType = 'FAULT' | 'MAINTENANCE' | 'VISIT' | 'DELIVERY' | 'PAYMENT_COLLECTION';
export type UserRole = 'ADMIN' | 'TECHNICIAN';

export interface Device {
  model: string;
  counter: number;
  spareTonerCount: number;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface Customer {
  id: string;
  name: string;
  address: string;
  phone: string;
  maintenanceIntervalMonths: number;
  lastVisitDate?: any;
  devices: Device[];
  balance: number;
}

export interface ChecklistItem {
  id: string;
  label: string;
  completed: boolean;
}

export interface ServiceRequest {
  id: string;
  customerId?: string;
  customerName: string;
  customerAddress: string;
  customerPhone?: string;
  type: ServiceType;
  status: ServiceStatus;
  description: string;
  technicianId: string;
  technicianName: string;
  createdAt: any;
  startedAt?: any;
  completedAt?: any;
  location?: {
    lat: number;
    lng: number;
  };
  photos: string[];
  signature?: string;
  checklist: ChecklistItem[];
  notes?: string;
  partsNeeded?: string[];
  dueDate?: any;
  counterReading?: number;
  tonerCountReported?: number;
  paymentCollected?: number;
}

export interface PaymentFollowUp {
  id: string;
  customerId: string;
  customerName: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  dueDate: any;
  status: 'PENDING' | 'PARTIAL' | 'PAID';
  note: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}
