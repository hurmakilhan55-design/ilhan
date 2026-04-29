import { useEffect, useState, useMemo } from 'react';
import { 
  collection, 
  query, 
  where,
  onSnapshot, 
  doc, 
  updateDoc, 
  addDoc, 
  deleteDoc,
  serverTimestamp,
  orderBy,
  setDoc,
  getDoc,
  limit,
  Timestamp
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  Camera, 
  CheckCircle2, 
  MapPin, 
  ClipboardCheck, 
  LogOut, 
  Plus, 
  ChevronRight, 
  Clock, 
  Phone,
  User as UserIcon,
  Home,
  CheckSquare,
  Users,
  Calendar,
  AlertTriangle,
  Package,
  CreditCard,
  LayoutDashboard,
  Search,
  Filter,
  Wrench,
  Printer,
  X,
  Edit2,
  Trash2,
  AlertCircle
} from 'lucide-react';
import { auth, signInWithGoogle, logOut, db } from './lib/firebase';
import { 
  ServiceRequest, 
  ServiceStatus, 
  OperationType, 
  UserRole, 
  UserProfile, 
  Customer, 
  PaymentFollowUp,
  ServiceType
} from './types';
import { handleFirestoreError } from './utils';
import { SignaturePad } from './components/SignaturePad';
import { motion, AnimatePresence } from 'motion/react';
import { format, addMonths, addDays, subDays, isBefore, isAfter, startOfDay, endOfDay } from 'date-fns';
import { tr } from 'date-fns/locale';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

type ManagerTab = 'DASHBOARD' | 'CUSTOMERS' | 'DISPATCH' | 'MAINTENANCE' | 'PAYMENTS' | 'STAFF';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<ServiceRequest[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [payments, setPayments] = useState<PaymentFollowUp[]>([]);
  const [technicians, setTechnicians] = useState<UserProfile[]>([]);
  
  const [selectedService, setSelectedService] = useState<ServiceRequest | null>(null);
  const [view, setView] = useState<'LIST' | 'DETAIL' | 'ADMIN' | 'LOGIN'>('LIST');
  const [managerTab, setManagerTab] = useState<ManagerTab>('DASHBOARD');
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);

  const handleStatClick = (tabId: ManagerTab, filter?: string) => {
    setManagerTab(tabId);
    if (filter) setSelectedFilter(filter);
    else setSelectedFilter(null);
  };

  // Load User & Role
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        const userDoc = await getDoc(doc(db, 'users', u.uid));
        
        if (userDoc.exists()) {
          setUserProfile({ id: u.uid, ...userDoc.data() } as UserProfile);
        } else {
          // Check if admin email
          const isAdmin = u.email === 'hurmakilhan55@gmail.com';
          const initialProfile: Omit<UserProfile, 'id'> = {
            name: u.displayName || 'İsimsiz Kullanıcı',
            email: u.email || '',
            role: isAdmin ? 'ADMIN' : 'TECHNICIAN',
            status: 'ACTIVE'
          };
          await setDoc(doc(db, 'users', u.uid), initialProfile);
          setUserProfile({ id: u.uid, ...initialProfile } as UserProfile);
        }
      } else {
        setUser(null);
        setUserProfile(null);
      }
      setLoading(false);
    });
  }, []);

  // Sync Global Data for Admin
  useEffect(() => {
    if (!userProfile || userProfile.role !== 'ADMIN') return;

    // Services
    const qServices = query(collection(db, 'services'), orderBy('createdAt', 'desc'));
    const unsubServices = onSnapshot(qServices, (s) => {
      setServices(s.docs.map(d => ({ id: d.id, ...d.data() } as ServiceRequest)));
    });

    // Customers
    const qCustomers = query(collection(db, 'customers'), orderBy('name', 'asc'));
    const unsubCustomers = onSnapshot(qCustomers, (s) => {
      setCustomers(s.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
    });

    // Payments
    const qPayments = query(collection(db, 'payments'), orderBy('dueDate', 'asc'));
    const unsubPayments = onSnapshot(qPayments, (s) => {
      setPayments(s.docs.map(d => ({ id: d.id, ...d.data() } as PaymentFollowUp)));
    });

    // Technicians
    const qTechs = query(collection(db, 'users'), orderBy('name', 'asc'));
    const unsubTechs = onSnapshot(qTechs, (s) => {
      setTechnicians(s.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile)).filter(t => t.role === 'TECHNICIAN'));
    });

    return () => {
      unsubServices();
      unsubCustomers();
      unsubPayments();
      unsubTechs();
    };
  }, [userProfile]);

  // Sync Personal Tasks for Technician
  useEffect(() => {
    if (!userProfile || userProfile.role !== 'TECHNICIAN') return;

    const q = query(
      collection(db, 'services'),
      where('technicianId', '==', userProfile.id),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setServices(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ServiceRequest)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'services');
    });

    return unsubscribe;
  }, [userProfile]);

  // Automated Job Generation Logic (Background)
  useEffect(() => {
    if (!userProfile || userProfile.role !== 'ADMIN' || customers.length === 0) return;

    const checkAndGenerateJobs = async () => {
      const now = new Date();
      
      // 1. Maintenance Jobs
      for (const customer of customers) {
        const lastDate = (customer.lastVisitDate && typeof customer.lastVisitDate.toDate === 'function') ? customer.lastVisitDate.toDate() : new Date(0);
        const nextDate = addMonths(lastDate, customer.maintenanceIntervalMonths);
        
        if (isBefore(nextDate, now)) {
          // Check if there's already a pending maintenance job
          const existing = services.find(s => s.customerId === customer.id && s.type === 'MAINTENANCE' && s.status !== 'COMPLETED');
          if (!existing) {
            await addDoc(collection(db, 'services'), {
              customerId: customer.id,
              customerName: customer.name,
              customerAddress: customer.address,
              type: 'MAINTENANCE',
              status: 'PENDING',
              description: 'Otomatik periyodik bakım iş emri.',
              technicianId: '',
              technicianName: 'Atanmadı',
              createdAt: serverTimestamp(),
              photos: [],
              checklist: [{ id: '1', label: 'Periyodik Bakım Yapıldı', completed: false }]
            });
          }
        }
      }

      // 2. Payment Collection Jobs
      for (const payment of payments) {
        if (payment.status !== 'PAID' && payment.dueDate && typeof payment.dueDate.toDate === 'function') {
          const dueDate = payment.dueDate.toDate();
          if (isBefore(dueDate, now)) {
             const existing = services.find(s => s.customerId === payment.customerId && s.type === 'PAYMENT_COLLECTION' && s.status !== 'COMPLETED');
             if (!existing) {
                await addDoc(collection(db, 'services'), {
                  customerId: payment.customerId,
                  customerName: payment.customerName,
                  customerAddress: '', // Would need to fetch from customer doc ideally
                  type: 'PAYMENT_COLLECTION',
                  status: 'PENDING',
                  description: `Tahsilat İş Emri: ${payment.note || ''}`,
                  technicianId: '',
                  technicianName: 'Atanmadı',
                  createdAt: serverTimestamp(),
                  photos: [],
                  checklist: [{ id: '1', label: 'Ödeme Alındı', completed: false }]
                });
             }
          }
        }
      }
    };

    const timer = setTimeout(checkAndGenerateJobs, 5000); // Debounce check
    return () => clearTimeout(timer);
  }, [userProfile, customers, services, payments]);

  // Dummy Data Seeding (One-time)
  useEffect(() => {
    if (loading || customers.length > 0 || !userProfile || userProfile.role !== 'ADMIN') return;

    const seedData = async () => {
      const dummyCustomers = [
        { name: 'Tekno Market A.Ş.', address: 'Bağdat Cad. No:123, İstanbul', phone: '0216 123 45 67', maintenanceIntervalMonths: 2, balance: 1500, lastVisitDate: new Date(), devices: [{ model: 'Kyocera TASKalfa 2554ci', counter: 45200, spareTonerCount: 2 }] },
        { name: 'Güneş Hukuk Bürosu', address: 'Adalet Sok. No:5, Ankara', phone: '0312 987 65 43', maintenanceIntervalMonths: 3, balance: -500, lastVisitDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), devices: [{ model: 'HP LaserJet M507dn', counter: 12500, spareTonerCount: 1 }] },
        { name: 'Mavi İnşaat Ltd.', address: 'Şantiye Yanı No:1, İzmir', phone: '0232 444 0 555', maintenanceIntervalMonths: 1, balance: 0, lastVisitDate: new Date(), devices: [{ model: 'Brother MFC-L2710DW', counter: 8900, spareTonerCount: 3 }] },
        { name: 'Özcan Eczanesi', address: 'Sağlık Cad. No:12, Samsun', phone: '0362 111 22 33', maintenanceIntervalMonths: 2, balance: 250, lastVisitDate: new Date(Date.now() - 65 * 24 * 60 * 60 * 1000), devices: [{ model: 'Kyocera ECOSYS M2040dn', counter: 31200, spareTonerCount: 1 }] },
        { name: 'Global Lojistik', address: 'Liman Yolu No:88, Mersin', phone: '0324 555 66 77', maintenanceIntervalMonths: 3, balance: -2000, lastVisitDate: new Date(), devices: [{ model: 'Canon iR-ADV C3525i', counter: 112000, spareTonerCount: 0 }] },
        { name: 'Yıldız Mimarlık', address: 'Tasarım Ofisi No:3, Bursa', phone: '0224 333 44 55', maintenanceIntervalMonths: 2, balance: 1200, lastVisitDate: new Date(), devices: [{ model: 'HP DesignJet T650', counter: 5400, spareTonerCount: 2 }] },
        { name: 'Balkan Gıda', address: 'Sanayi Bölgesi No:44, Kocaeli', phone: '0262 777 88 99', maintenanceIntervalMonths: 1, balance: 0, lastVisitDate: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), devices: [{ model: 'Kyocera TASKalfa 4012id', counter: 78900, spareTonerCount: 4 }] },
        { name: 'Aras Sigorta', address: 'Güvence Han No:1, Antalya', phone: '0242 666 77 88', maintenanceIntervalMonths: 3, balance: 500, lastVisitDate: new Date(), devices: [{ model: 'Brother HL-L2350DW', counter: 15400, spareTonerCount: 2 }] },
        { name: 'Focus Eğitim Kurumları', address: 'Okul Yolu No:10, Eskişehir', phone: '0222 555 11 22', maintenanceIntervalMonths: 2, balance: -150, lastVisitDate: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000), devices: [{ model: 'Kyocera ECOSYS M5526cdw', counter: 22100, spareTonerCount: 1 }] },
        { name: 'Ege Dental Klinik', address: 'Dişçi Sok. No:7, Aydın', phone: '0256 999 88 77', maintenanceIntervalMonths: 3, balance: 0, lastVisitDate: new Date(), devices: [{ model: 'HP Color LaserJet Pro M454dw', counter: 18900, spareTonerCount: 2 }] }
      ];

      try {
        for (const c of dummyCustomers) {
          await addDoc(collection(db, 'customers'), {
            ...c,
            lastVisitDate: Timestamp.fromDate(c.lastVisitDate),
            createdAt: serverTimestamp()
          });
        }
      } catch (e) {
        console.error('Error seeding dummy data:', e);
      }
    };

    seedData();
  }, [loading, customers, userProfile]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user || !userProfile) {
    return <AuthView />;
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      {userProfile.role === 'ADMIN' ? (
        <ManagerView 
          tab={managerTab} 
          setTab={setManagerTab}
          onStatClick={handleStatClick}
          selectedFilter={selectedFilter}
          services={services}
          customers={customers}
          payments={payments}
          technicians={technicians}
          user={user}
        />
      ) : (
        <TechnicianView 
          services={services} 
          view={view} 
          setView={setView}
          selectedService={selectedService}
          setSelectedService={setSelectedService}
          user={user}
        />
      )}
    </div>
  );
}


function ManagerView({ 
  tab, 
  setTab, 
  onStatClick,
  selectedFilter,
  services, 
  customers, 
  payments, 
  technicians,
  user
}: { 
  tab: ManagerTab, 
  setTab: (t: ManagerTab) => void,
  onStatClick: (tabId: ManagerTab, filter?: string) => void,
  selectedFilter: string | null,
  services: ServiceRequest[],
  customers: Customer[],
  payments: PaymentFollowUp[],
  technicians: UserProfile[],
  user: User
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col hidden lg:flex">
        <div className="p-8 border-b border-slate-800 flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center font-bold text-xs italic text-white leading-none">Hürmak</div>
          <h2 className="text-sm font-black text-white uppercase tracking-tighter">YÖNETİM</h2>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {[
            { id: 'DASHBOARD', icon: LayoutDashboard, label: 'Gösterge Paneli' },
            { id: 'DISPATCH', icon: Wrench, label: 'İş Emirleri' },
            { id: 'CUSTOMERS', icon: Users, label: 'Müşteriler' },
            { id: 'MAINTENANCE', icon: Calendar, label: 'Bakım Takibi' },
            { id: 'PAYMENTS', icon: CreditCard, label: 'Ödemeler' },
            { id: 'STAFF', icon: UserIcon, label: 'Personel' }
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id as ManagerTab)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                tab === item.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'hover:bg-slate-800'
              }`}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800">
           <button onClick={logOut} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-red-400 hover:bg-red-400/10 transition-all">
             <LogOut className="w-5 h-5" />
             <span>Çıkış Yap</span>
           </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-slate-50 relative">
        <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-slate-200 px-8 py-4 flex justify-between items-center shadow-sm lg:hidden">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center font-bold text-[8px] italic text-white">Hürmak</div>
            <h2 className="text-xs font-black text-slate-900 uppercase tracking-tight">{tab}</h2>
          </div>
          <button onClick={logOut} className="p-2 text-slate-400">
            <LogOut className="w-5 h-5" />
          </button>
        </header>

        <div className="p-8 max-w-7xl mx-auto space-y-8">
           <AnimatePresence mode="wait">
             <motion.div
               key={tab}
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -10 }}
               transition={{ duration: 0.2 }}
             >
               {tab === 'DASHBOARD' && <Dashboard services={services} technicians={technicians} customers={customers} payments={payments} onStatClick={onStatClick} />}
               {tab === 'CUSTOMERS' && <CustomerManagement customers={customers} />}
               {tab === 'DISPATCH' && <ServiceManagement services={services} technicians={technicians} customers={customers} initialFilter={selectedFilter} />}
               {tab === 'MAINTENANCE' && <MaintenanceAgreements customers={customers} services={services} />}
               {tab === 'PAYMENTS' && <PaymentFollowUps payments={payments} customers={customers} />}
               {tab === 'STAFF' && <StaffManagement technicians={technicians} services={services} />}
             </motion.div>
           </AnimatePresence>
        </div>

        {/* Mobile Nav */}
        <nav className="fixed bottom-0 left-0 right-0 bg-slate-900 text-slate-400 px-4 py-3 flex justify-around items-center lg:hidden z-50">
          {[
            { id: 'DASHBOARD', icon: LayoutDashboard },
            { id: 'DISPATCH', icon: Wrench },
            { id: 'CUSTOMERS', icon: Users },
            { id: 'PAYMENTS', icon: CreditCard }
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id as ManagerTab)}
              className={`p-2 rounded-lg ${tab === item.id ? 'text-blue-500 bg-slate-800' : ''}`}
            >
              <item.icon className="w-5 h-5" />
            </button>
          ))}
        </nav>
      </main>
    </div>
  );
}

function Dashboard({ services, technicians, customers, payments, onStatClick }: { services: ServiceRequest[], technicians: UserProfile[], customers: Customer[], payments: PaymentFollowUp[], onStatClick: (tab: string, filter?: string) => void }) {
  const stats = useMemo(() => {
    return {
      total: services.length,
      pending: services.filter(s => s.status === 'PENDING' || s.status === 'ASSIGNED').length,
      inProgress: services.filter(s => s.status === 'IN_PROGRESS').length,
      completed: services.filter(s => s.status === 'COMPLETED').length,
      waitingPart: services.filter(s => s.status === 'WAITING_PART').length,
      totalCustomers: customers.length
    };
  }, [services, customers]);

  const maintenanceDueCount = useMemo(() => {
    return customers.filter(c => {
      const lastVisit = (c.lastVisitDate && typeof c.lastVisitDate.toDate === 'function') ? c.lastVisitDate.toDate() : new Date(0);
      const nextDate = addMonths(lastVisit, c.maintenanceIntervalMonths);
      return isBefore(nextDate, new Date());
    }).length;
  }, [customers]);

  const chartData = useMemo(() => {
    const last7Days = Array.from({ length: 7 }).map((_, i) => {
      const d = subDays(new Date(), i);
      return format(d, 'dd MMM', { locale: tr });
    }).reverse();

    return last7Days.map(label => ({
      name: label,
      completed: services.filter(s => s.status === 'COMPLETED' && s.completedAt && typeof s.completedAt.toDate === 'function' && format(s.completedAt.toDate(), 'dd MMM', { locale: tr }) === label).length,
      created: services.filter(s => s.createdAt && typeof s.createdAt.toDate === 'function' && format(s.createdAt.toDate(), 'dd MMM', { locale: tr }) === label).length
    }));
  }, [services]);

  const paymentReminders = useMemo(() => {
    return payments
      .filter(p => p.status !== 'PAID' && p.dueDate && typeof p.dueDate.toDate === 'function' && isBefore(p.dueDate.toDate(), addDays(new Date(), 7)))
      .sort((a,b) => {
        const aDate = a.dueDate && typeof a.dueDate.toDate === 'function' ? a.dueDate.toDate().getTime() : 0;
        const bDate = b.dueDate && typeof b.dueDate.toDate === 'function' ? b.dueDate.toDate().getTime() : 0;
        return aDate - bDate;
      });
  }, [payments]);

  const dashboardStatsList = useMemo(() => {
    const totalRevenue = payments.reduce((acc, curr) => acc + (Number(curr.paidAmount) || 0), 0);
    const pendingRevenue = payments.reduce((acc, curr) => acc + (Number(curr.remainingAmount) || 0), 0);
    
    return [
      { label: 'Aktif Arıza', value: stats.pending + stats.inProgress, icon: Wrench, color: 'text-blue-600', bg: 'bg-blue-50', tab: 'DISPATCH', filter: 'ACTIVE' },
      { label: 'Parça Bekleyen', value: stats.waitingPart, icon: Package, color: 'text-amber-600', bg: 'bg-amber-50', tab: 'DISPATCH', filter: 'WAITING_PART' },
      { label: 'Bakım Bekleyen', value: maintenanceDueCount, icon: Clock, color: 'text-rose-600', bg: 'bg-rose-50', tab: 'MAINTENANCE' },
      { label: 'Tahsil Edilen', value: `₺${(totalRevenue || 0).toLocaleString('tr-TR')}`, icon: CreditCard, color: 'text-emerald-600', bg: 'bg-emerald-50', tab: 'PAYMENTS' },
      { label: 'Bekleyen Tutar', value: `₺${(pendingRevenue || 0).toLocaleString('tr-TR')}`, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', tab: 'PAYMENTS' }
    ];
  }, [stats, payments, technicians, maintenanceDueCount]);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        {dashboardStatsList.map((stat, i) => (
          <button 
            key={i} 
            onClick={() => onStatClick(stat.tab, stat.filter)}
            className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4 text-left hover:border-blue-400 transition-all active:scale-[0.98]"
          >
             <div className={`${stat.bg} w-12 h-12 rounded-xl flex items-center justify-center ${stat.color}`}>
                <stat.icon className="w-6 h-6" />
             </div>
             <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{stat.label}</p>
                <p className="text-2xl font-black text-slate-900 tracking-tight">{stat.value}</p>
             </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
           <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Haftalık Performans</h3>
           <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    itemStyle={{ fontSize: '12px', fontWeight: 600 }}
                  />
                  <Bar dataKey="created" name="Açılan İşler" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="completed" name="Biten İşler" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
           </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest px-2">Ödeme Hatırlatıcıları</h3>
            <div className="space-y-3">
              {paymentReminders.map(p => {
                const isOverdue = p.dueDate && typeof p.dueDate.toDate === 'function' ? isBefore(p.dueDate.toDate(), new Date()) : false;
                return (
                  <div key={p.id} className={`p-4 rounded-2xl border flex items-center gap-4 ${isOverdue ? 'bg-red-50 border-red-100' : 'bg-blue-50 border-blue-100'}`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isOverdue ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-slate-900 uppercase leading-none">{p.customerName}</p>
                      <p className="text-[10px] font-bold text-slate-400 mt-1">₺{(p.remainingAmount || 0).toLocaleString('tr-TR')} • {p.dueDate && typeof p.dueDate.toDate === 'function' ? format(p.dueDate.toDate(), 'dd MMM') : ''}</p>
                    </div>
                  </div>
                );
              })}
              {paymentReminders.length === 0 && <p className="text-xs font-bold text-slate-300 italic px-2">Yakın zamanda ödeme bulunmuyor.</p>}
            </div>
          </div>

          <div className="p-6 bg-slate-900 rounded-[2.5rem] text-white shadow-xl shadow-slate-200">
             <div className="flex justify-between items-center mb-6">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Teknisyen Durumu</h4>
                <button className="text-[10px] font-bold text-blue-400 uppercase">Hepsini Gör</button>
             </div>
             <div className="space-y-4">
                {technicians.slice(0, 3).map(tech => (
                   <div key={tech.id} className="flex items-center gap-4">
                      <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-xs font-black">
                         {tech.name.charAt(0)}
                      </div>
                      <div className="flex-1">
                         <div className="flex justify-between text-[10px] font-black uppercase mb-1">
                            <span>{tech.name}</span>
                            <span className="text-slate-400">AKTİF</span>
                         </div>
                         <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                            <div className="bg-emerald-500 h-full w-[65%]" />
                         </div>
                      </div>
                   </div>
                ))}
             </div>
          </div>
        </div>
      </div>

      <RecentServices services={services.slice(0, 5)} />
    </div>
  );
}

function RecentServices({ services }: { services: ServiceRequest[] }) {
  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center">
        <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Son İş Emirleri</h3>
        <button className="text-[10px] font-bold text-blue-600 uppercase">Hepsini Gör</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
              <th className="px-6 py-4">Müşteri</th>
              <th className="px-6 py-4">İş Türü</th>
              <th className="px-6 py-4">Teknisyen</th>
              <th className="px-6 py-4">Durum</th>
              <th className="px-6 py-4 text-right">Tarih</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {services.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50/50 transition-colors group">
                <td className="px-6 py-4">
                  <p className="text-xs font-bold text-slate-900">{s.customerName}</p>
                </td>
                <td className="px-6 py-4">
                  <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md">{s.type}</span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-[10px] font-black text-blue-600">
                      {s.technicianName.charAt(0)}
                    </div>
                    <span className="text-xs font-medium text-slate-600">{s.technicianName}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${
                    s.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                    s.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>
                    {s.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="text-[10px] font-bold text-slate-400">{s.createdAt && typeof s.createdAt.toDate === 'function' ? format(s.createdAt.toDate(), 'dd MMM HH:mm', { locale: tr }) : ''}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomerManagement({ customers }: { customers: Customer[] }) {
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone.includes(searchTerm)
  );

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    try {
      await updateDoc(doc(db, 'customers', selectedCustomer.id), {
        name: selectedCustomer.name,
        phone: selectedCustomer.phone,
        address: selectedCustomer.address,
        maintenanceIntervalMonths: selectedCustomer.maintenanceIntervalMonths,
        balance: selectedCustomer.balance
      });
      setIsEditing(false);
      setSelectedCustomer(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'customers');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Müşteri Yönetimi</h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Müşteri Listesi ve Detaylar</p>
        </div>
        <div className="flex gap-4 w-full md:w-auto">
          <div className="relative flex-1 md:flex-none">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              placeholder="Müşteri Ara..." 
              className="pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold w-full md:w-64"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button 
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-500/20 uppercase tracking-widest"
          >
            <Plus className="w-5 h-5" /> Yeni
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Müşteri Bilgisi</th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Telefon</th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Bakım</th>
                <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Bakiye</th>
                <th className="px-8 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCustomers.map(c => (
                <tr key={c.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-4">
                    <button 
                      onClick={() => { setSelectedCustomer(c); setIsEditing(false); }}
                      className="text-left group"
                    >
                      <h4 className="font-black text-slate-900 uppercase leading-none group-hover:text-blue-600 transition-colors">{c.name}</h4>
                      <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase truncate max-w-[200px]">{c.address}</p>
                    </button>
                  </td>
                  <td className="px-8 py-4">
                    <span className="text-sm font-bold text-slate-600">{c.phone}</span>
                  </td>
                  <td className="px-8 py-4 text-center text-sm font-black text-slate-900">
                    {c.maintenanceIntervalMonths} Ay
                  </td>
                  <td className="px-8 py-4 text-right">
                    <span className={`text-sm font-black ${c.balance < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                       ₺{Math.abs(c.balance || 0).toLocaleString('tr-TR')}
                    </span>
                  </td>
                  <td className="px-8 py-4 text-right">
                    <button 
                      onClick={() => { setSelectedCustomer(c); setIsEditing(true); }}
                      className="p-2 text-slate-300 hover:text-blue-600 transition-colors"
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAddForm && (
        <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6 text-slate-900">
           <CustomerForm onClose={() => setShowAddForm(false)} />
        </div>
      )}

      {selectedCustomer && (
        <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6 text-slate-900">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="bg-slate-900 p-8 text-white flex justify-between items-center sticky top-0 z-10">
              <h3 className="text-xl font-black uppercase tracking-tight">{isEditing ? 'Düzenle' : 'Detaylar'}</h3>
              <button onClick={() => setSelectedCustomer(null)} className="p-2 text-slate-400 hover:text-white"><X className="w-8 h-8" /></button>
            </div>
            
            <div className="p-8">
              {isEditing ? (
                <form onSubmit={handleUpdateCustomer} className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <input className="col-span-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="Müşteri Adı" value={selectedCustomer.name} onChange={e => setSelectedCustomer({...selectedCustomer, name: e.target.value})} />
                    <input className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="Telefon" value={selectedCustomer.phone} onChange={e => setSelectedCustomer({...selectedCustomer, phone: e.target.value})} />
                    <input type="number" className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="Bakım Aralığı" value={selectedCustomer.maintenanceIntervalMonths} onChange={e => setSelectedCustomer({...selectedCustomer, maintenanceIntervalMonths: parseInt(e.target.value)})} />
                    <textarea className="col-span-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="Adres" value={selectedCustomer.address} onChange={e => setSelectedCustomer({...selectedCustomer, address: e.target.value})} />
                    <input type="number" className="col-span-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="Bakiye" value={selectedCustomer.balance} onChange={e => setSelectedCustomer({...selectedCustomer, balance: parseInt(e.target.value)})} />
                  </div>
                  <button type="submit" className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest">Kaydet</button>
                </form>
              ) : (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                    <div className="bg-slate-50 p-4 rounded-2xl">
                      <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Bakım Aralığı</p>
                      <p className="text-lg font-black text-slate-900">{selectedCustomer.maintenanceIntervalMonths} Ay</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl col-span-2">
                       <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Cari Bakiye</p>
                       <p className={`text-xl font-black ${selectedCustomer.balance < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                          ₺{selectedCustomer.balance?.toLocaleString('tr-TR') || 0}
                          <span className="text-[10px] ml-2 italic">{selectedCustomer.balance < 0 ? 'BORÇ' : 'ALACAK'}</span>
                       </p>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Cihazlar</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {selectedCustomer.devices?.map((dev, idx) => (
                        <div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-4">
                           <Printer className="w-5 h-5 text-slate-400" />
                           <div>
                              <p className="text-xs font-black text-slate-900 uppercase">{dev.model}</p>
                              <p className="text-[10px] font-bold text-slate-400">{dev.counter?.toLocaleString()} Sayaç</p>
                           </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => setIsEditing(true)} className="w-full py-4 border-2 border-slate-900 rounded-2xl text-slate-900 font-black uppercase tracking-widest">Düzenle</button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function CustomerForm({ onClose }: { onClose: () => void }) {
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    maintenanceIntervalMonths: 1,
    balance: 0,
    devices: [{ model: '', counter: 0, spareTonerCount: 0 }]
  });

  const addDevice = () => {
    setFormData({
      ...formData,
      devices: [...formData.devices, { model: '', counter: 0, spareTonerCount: 0 }]
    });
  };

  const updateDevice = (idx: number, field: string, value: any) => {
    const newDevices = [...formData.devices];
    newDevices[idx] = { ...newDevices[idx], [field]: value };
    setFormData({ ...formData, devices: newDevices });
  };

  const removeDevice = (idx: number) => {
    if (formData.devices.length <= 1) return;
    setFormData({
      ...formData,
      devices: formData.devices.filter((_, i) => i !== idx)
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'customers'), {
        ...formData,
        createdAt: serverTimestamp()
      });
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'customers');
    }
  };

  return (
    <motion.div 
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden my-8"
    >
      <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
         <div>
            <h3 className="text-xl font-black uppercase tracking-tighter">Müşteri & Cihaz Kaydı</h3>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Detaylı cihaz ve bakiye bilgileri</p>
         </div>
         <button onClick={onClose} className="p-2 text-slate-500 hover:text-white">
            <Plus className="w-8 h-8 rotate-45" />
         </button>
      </div>
      <form onSubmit={handleSubmit} className="p-8 space-y-8 max-h-[80vh] overflow-y-auto">
        <div className="grid grid-cols-2 gap-6">
           <div className="col-span-2 space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Firma / Müşteri Ünvanı</label>
              <input required className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold focus:ring-blue-500 focus:border-blue-500" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
           </div>
           <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">İletişim No</label>
              <input required className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
           </div>
           <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Bakım Periyodu (Ay)</label>
              <select className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" value={formData.maintenanceIntervalMonths} onChange={e => setFormData({...formData, maintenanceIntervalMonths: Number(e.target.value)})}>
                {[1, 2, 3, 4, 6, 12].map(m => <option key={m} value={m}>{m} Ay</option>)}
              </select>
           </div>
           <div className="col-span-1 space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Mevcut Bakiye (TL)</label>
              <input type="number" className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" value={formData.balance} onChange={e => setFormData({...formData, balance: Number(e.target.value)})} />
           </div>
           <div className="col-span-2 space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Adres Bilgisi</label>
              <textarea required className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold min-h-[80px]" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} />
           </div>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center px-1">
            <h4 className="text-xs font-black text-slate-900 uppercase">Cihaz Listesi</h4>
            <button type="button" onClick={addDevice} className="text-[10px] font-bold text-blue-600 uppercase border-b-2 border-blue-600 pb-0.5">+ Cihaz Ekle</button>
          </div>
          
          <div className="space-y-4">
            {formData.devices.map((dev, idx) => (
              <div key={idx} className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-4 relative">
                {formData.devices.length > 1 && (
                  <button type="button" onClick={() => removeDevice(idx)} className="absolute top-4 right-4 text-[9px] font-black text-red-500 uppercase">Sıfırla</button>
                )}
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-3 lg:col-span-1 space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase">Model</label>
                    <input required className="w-full bg-white border-slate-200 rounded-lg px-3 py-2 text-xs font-bold" value={dev.model} onChange={e => updateDevice(idx, 'model', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase">Güncel Sayaç</label>
                    <input type="number" className="w-full bg-white border-slate-200 rounded-lg px-3 py-2 text-xs font-bold" value={dev.counter} onChange={e => updateDevice(idx, 'counter', Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase">Yedek Toner</label>
                    <input type="number" className="w-full bg-white border-slate-200 rounded-lg px-3 py-2 text-xs font-bold" value={dev.spareTonerCount} onChange={e => updateDevice(idx, 'spareTonerCount', Number(e.target.value))} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <button type="submit" className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-blue-500/20">Kaydı Tamamla</button>
      </form>
    </motion.div>
  );
}

function ServiceManagement({ services, technicians, customers, initialFilter }: { services: ServiceRequest[], technicians: UserProfile[], customers: Customer[], initialFilter: string | null }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedService, setSelectedService] = useState<ServiceRequest | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const statusLabels: Record<string, { label: string, color: string }> = {
    'PENDING': { label: 'Beklemede', color: 'bg-slate-500' },
    'ASSIGNED': { label: 'Atandı', color: 'bg-blue-500' },
    'IN_PROGRESS': { label: 'İşlemde', color: 'bg-amber-500' },
    'WAITING_PART': { label: 'Parça Bekliyor', color: 'bg-rose-500' },
    'REVISIT_REQUIRED': { label: 'Tekrar Gidilecek', color: 'bg-purple-500' },
    'COMPLETED': { label: 'Tamamlandı', color: 'bg-emerald-500' },
    'FAULT': { label: 'Arıza', color: 'bg-red-50' },
    'MAINTENANCE': { label: 'Bakım', color: 'bg-emerald-50' },
    'INSTALLATION': { label: 'Kurulum', color: 'bg-blue-50' }
  };

  const handleUpdateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedService) return;
    try {
      const tech = technicians.find(t => t.id === selectedService.technicianId);
      await updateDoc(doc(db, 'services', selectedService.id), {
        description: selectedService.description,
        status: selectedService.status,
        technicianId: selectedService.technicianId,
        technicianName: tech ? tech.name : selectedService.technicianName,
        type: selectedService.type
      });
      setIsEditing(false);
      setSelectedService(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'services');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Teknik Servis Yönetimi</h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">İş Emirleri ve Personel Atama</p>
        </div>
        <button 
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm shadow-xl shadow-blue-500/20 hover:bg-blue-700 transition-all uppercase tracking-widest"
        >
          <Plus className="w-5 h-5" />
          Yeni İş Emri
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_PART', 'REVISIT_REQUIRED', 'COMPLETED'].map((status) => {
          const filtered = services.filter(s => s.status === status);
          if (initialFilter && initialFilter !== status && status !== 'WAITING_PART') {
            // If we have an initial filter, we still show all boards but we could highlight.
            // For simplicity, let's just keep the layout.
          }
          
          return (
            <div key={status} className={`p-4 rounded-3xl border transition-all ${initialFilter === status ? 'bg-blue-50/50 border-blue-200' : 'bg-slate-100/50 border-slate-200/50'} space-y-4`}>
               <div className="flex justify-between items-center px-4">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{statusLabels[status]?.label || status}</h4>
                  <span className="bg-white px-2 py-0.5 rounded-lg text-[10px] font-black text-slate-600 shadow-sm">{filtered.length}</span>
               </div>
               <div className="space-y-3">
                  {filtered.map(s => (
                    <button 
                      key={s.id} 
                      onClick={() => { setSelectedService(s); setIsEditing(false); }}
                      className="w-full text-left bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3 hover:shadow-md hover:border-blue-200 transition-all group"
                    >
                       <div className="flex justify-between items-start">
                          <h5 className="text-xs font-black text-slate-900 uppercase leading-snug group-hover:text-blue-600 transition-colors">{s.customerName}</h5>
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${statusLabels[s.type]?.color || 'bg-slate-50'} text-slate-600`}>
                            {statusLabels[s.type]?.label || s.type}
                          </span>
                       </div>
                       <p className="text-[10px] font-bold text-slate-400 line-clamp-2">{s.description}</p>
                       <div className="flex justify-between items-center pt-3 border-t border-slate-50">
                          <div className="flex items-center gap-1.5 text-[9px] font-black text-slate-600 uppercase">
                             <div className="w-5 h-5 bg-slate-900 rounded-full flex items-center justify-center text-white text-[7px]">
                                {s.technicianName.charAt(0)}
                             </div>
                             <span className="truncate max-w-[80px]">{s.technicianName}</span>
                          </div>
                          <span className="text-[8px] font-bold text-slate-300">
                            {s.createdAt && typeof s.createdAt.toDate === 'function' ? format(s.createdAt.toDate(), 'dd MMM', { locale: tr }) : ''}
                          </span>
                       </div>
                    </button>
                  ))}
               </div>
            </div>
          );
        })}
      </div>

      {showAddForm && (
        <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6 text-slate-900">
           <ServiceForm 
            onClose={() => setShowAddForm(false)} 
            customers={customers} 
            technicians={technicians} 
           />
        </div>
      )}

      {selectedService && (
        <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6 text-slate-900">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white w-full max-w-xl rounded-[2.5rem] shadow-2xl overflow-hidden">
            <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
              <div>
                <h3 className="text-xl font-black uppercase tracking-tight">{isEditing ? 'İş Emrini Düzenle' : 'İş Emri Detayları'}</h3>
                {!isEditing && <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">{selectedService.customerName}</p>}
              </div>
              <button onClick={() => setSelectedService(null)} className="p-2 text-slate-400 hover:text-white"><X className="w-8 h-8" /></button>
            </div>
            
            <div className="p-8">
              {isEditing ? (
                <form onSubmit={handleUpdateService} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Açıklama</label>
                    <textarea 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold min-h-[100px]" 
                      value={selectedService.description} 
                      onChange={e => setSelectedService({...selectedService, description: e.target.value})}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Durum</label>
                      <select 
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" 
                        value={selectedService.status} 
                        onChange={e => setSelectedService({...selectedService, status: e.target.value as any})}
                      >
                        {['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_PART', 'REVISIT_REQUIRED', 'COMPLETED'].map(st => (
                          <option key={st} value={st}>{statusLabels[st]?.label || st}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Teknisyen Ata</label>
                      <select 
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" 
                        value={selectedService.technicianId} 
                        onChange={e => setSelectedService({...selectedService, technicianId: e.target.value})}
                      >
                        {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <button type="submit" className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-700">Güncelle</button>
                </form>
              ) : (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="bg-slate-50 p-4 rounded-2xl">
                      <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Hizmet Türü</p>
                      <p className="text-sm font-black text-slate-900">{statusLabels[selectedService.type]?.label || selectedService.type}</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl">
                      <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Mevcut Durum</p>
                      <p className="text-sm font-black text-blue-600">{statusLabels[selectedService.status]?.label || selectedService.status}</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl">
                       <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Atanan Personel</p>
                       <p className="text-sm font-black text-slate-900">{selectedService.technicianName}</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl">
                       <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Tarih</p>
                       <p className="text-sm font-black text-slate-900">
                        {selectedService.createdAt && typeof selectedService.createdAt.toDate === 'function' ? format(selectedService.createdAt.toDate(), 'PPP', { locale: tr }) : 'Belirtilmemiş'}
                       </p>
                    </div>
                  </div>
                  <div className="bg-slate-50 p-6 rounded-2xl">
                    <p className="text-[8px] font-black text-slate-400 uppercase mb-3 px-1">Müşteri Açıklaması</p>
                    <p className="text-sm font-medium text-slate-600 leading-relaxed italic">\"{selectedService.description}\"</p>
                  </div>
                  <button 
                    onClick={() => setIsEditing(true)}
                    className="w-full py-4 border-2 border-slate-900 rounded-2xl text-slate-900 font-black uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all shadow-sm"
                  >
                    Bilgileri Düzenle / Teknisyen Değiştir
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function ServiceForm({ onClose, customers, technicians }: { onClose: () => void, customers: Customer[], technicians: UserProfile[] }) {
  const [formData, setFormData] = useState({
    customerId: '',
    type: 'FAULT' as ServiceType,
    technicianId: '',
    description: '',
    priority: 'NORMAL'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const customer = customers.find(c => c.id === formData.customerId);
    const tech = technicians.find(t => t.id === formData.technicianId);
    
    if (!customer || !tech) return;

    try {
      await addDoc(collection(db, 'services'), {
        ...formData,
        customerName: customer.name,
        customerAddress: customer.address,
        customerPhone: customer.phone,
        technicianName: tech.name,
        status: 'ASSIGNED',
        createdAt: serverTimestamp(),
        photos: [],
        checklist: [
          { id: '1', label: 'Cihaz Kontrolü Yapıldı', completed: false },
          { id: '2', label: 'Arıza Tespiti Tamamlandı', completed: false },
          { id: '3', label: 'Müşteri Bilgilendirildi', completed: false }
        ]
      });
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'services');
    }
  };

  return (
    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden">
      <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
         <div>
            <h3 className="text-xl font-black uppercase tracking-tighter">İş Emri & Atama</h3>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Teknisyen görevlendiriliyor</p>
         </div>
         <button onClick={onClose} className="p-2 text-slate-500 hover:text-white"><Plus className="w-8 h-8 rotate-45" /></button>
      </div>
      <form onSubmit={handleSubmit} className="p-8 space-y-6">
        <div className="grid grid-cols-2 gap-6">
           <div className="col-span-2 space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Müşteri Seçimi</label>
              <select required className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" value={formData.customerId} onChange={e => setFormData({...formData, customerId: e.target.value})}>
                <option value="">Lütfen Seçiniz</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
           </div>
           <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Hizmet Türü</label>
              <select className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value as ServiceType})}>
                <option value="FAULT">Ariza</option>
                <option value="MAINTENANCE">Bakim</option>
                <option value="VISIT">Ziyaret</option>
                <option value="DELIVERY">Teslimat</option>
              </select>
           </div>
           <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Teknisyen Atama</label>
              <select required className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" value={formData.technicianId} onChange={e => setFormData({...formData, technicianId: e.target.value})}>
                <option value="">Lütfen Seçiniz</option>
                {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
           </div>
           <div className="col-span-2 space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Açıklama & Notlar</label>
              <textarea required className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold min-h-[100px]" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
           </div>
        </div>
        <button type="submit" className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest">Görevlendir</button>
      </form>
    </motion.div>
  );
}

function MaintenanceAgreements({ customers, services }: { customers: Customer[], services: ServiceRequest[] }) {
  const [selectedCustomerReports, setSelectedCustomerReports] = useState<{name: string, reports: ServiceRequest[], nextDate: Date} | null>(null);

  const maintenanceList = useMemo(() => {
    return customers.map(c => {
      const lastService = services.filter(s => s.customerId === c.id && s.type === 'MAINTENANCE' && s.status === 'COMPLETED')[0];
      const lastVisit = (c.lastVisitDate && typeof c.lastVisitDate.toDate === 'function') ? c.lastVisitDate.toDate() : (lastService?.completedAt && typeof lastService.completedAt.toDate === 'function' ? lastService.completedAt.toDate() : new Date(0));
      const nextDate = addMonths(lastVisit, c.maintenanceIntervalMonths);
      const isDue = isBefore(nextDate, new Date());
      
      return { ...c, nextMaintenance: nextDate, isDue };
    });
  }, [customers, services]);

  const dueMaintenance = maintenanceList.filter(m => m.isDue).sort((a,b) => a.nextMaintenance.getTime() - b.nextMaintenance.getTime());
  const completedMaintenance = maintenanceList.filter(m => !m.isDue).sort((a,b) => b.nextMaintenance.getTime() - a.nextMaintenance.getTime());

  const showReports = (customer: any) => {
    const reports = services.filter(s => s.customerId === customer.id && s.status === 'COMPLETED').sort((a,b) => {
      const bDate = (b.completedAt && typeof b.completedAt.toDate === 'function') ? b.completedAt.toDate().getTime() : 0;
      const aDate = (a.completedAt && typeof a.completedAt.toDate === 'function') ? a.completedAt.toDate().getTime() : 0;
      return bDate - aDate;
    });
    setSelectedCustomerReports({ name: customer.name, reports, nextDate: customer.nextMaintenance });
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Bakım Takibi</h2>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Gidilmesi gereken ve tamamlanan bakımlar</p>
      </div>

      <div className="space-y-12">
        <section>
           <h3 className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-6 px-2 flex items-center gap-2">
             <AlertTriangle className="w-4 h-4" /> Vakti Gelen Bakımlar
           </h3>
           <div className="grid grid-cols-1 gap-4">
              {dueMaintenance.map(item => (
                <div key={item.id} className="bg-white p-6 rounded-[2rem] border-2 border-red-100 flex items-center justify-between shadow-sm group hover:border-red-200 transition-all">
                  <div className="flex gap-6 items-center">
                      <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center text-red-600">
                        <Calendar className="w-7 h-7" />
                      </div>
                      <div>
                        <button onClick={() => showReports(item)} className="text-left group">
                          <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight group-hover:text-red-600 transition-colors">{item.name}</h4>
                          <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">
                            {item.devices?.[0]?.model || 'Cihaz Belirtilmedi'} • {item.maintenanceIntervalMonths} Ayda Bir
                          </p>
                        </button>
                      </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase">Sıradaki Tarih</p>
                    <p className="text-sm font-black text-red-600 mt-1">{format(item.nextMaintenance, 'dd MMM yyyy', { locale: tr })}</p>
                  </div>
                </div>
              ))}
              {dueMaintenance.length === 0 && <p className="text-xs font-bold text-slate-300 italic px-2">Bekleyen bakım bulunmuyor.</p>}
           </div>
        </section>

        <section>
           <h3 className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-6 px-2 flex items-center gap-2">
             <CheckCircle2 className="w-4 h-4" /> Yaklaşan Bakımlar
           </h3>
           <div className="grid grid-cols-1 gap-4">
              {completedMaintenance.map(item => (
                <div key={item.id} className="bg-white p-6 rounded-[2rem] border border-slate-200 flex items-center justify-between shadow-sm hover:border-emerald-200 transition-all">
                  <div className="flex gap-6 items-center">
                      <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
                        <CheckCircle2 className="w-7 h-7" />
                      </div>
                      <div>
                        <button onClick={() => showReports(item)} className="text-left group">
                          <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight group-hover:text-emerald-600 transition-colors">{item.name}</h4>
                          <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">
                            {item.devices?.[0]?.model || 'Cihaz Belirtilmedi'} • {item.maintenanceIntervalMonths} Ayda Bir
                          </p>
                        </button>
                      </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase">Gelecek Tarih</p>
                    <p className="text-sm font-black text-slate-900 mt-1">{format(item.nextMaintenance, 'dd MMM yyyy', { locale: tr })}</p>
                  </div>
                </div>
              ))}
           </div>
        </section>
      </div>

      {selectedCustomerReports && (
        <div className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-6 text-slate-900">
           <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
              <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
                 <div>
                    <h3 className="text-xl font-black uppercase tracking-tighter">{selectedCustomerReports.name}</h3>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Bakım & Servis Geçmişi</p>
                 </div>
                 <button onClick={() => setSelectedCustomerReports(null)} className="p-2 text-slate-400 hover:text-white"><X className="w-8 h-8" /></button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 space-y-6">
                 <div className="bg-blue-50 p-6 rounded-3xl border border-blue-100 mb-4">
                    <p className="text-[10px] font-black text-blue-600 uppercase mb-1">Planlanan Bir Sonraki Bakım</p>
                    <p className="text-lg font-black text-blue-900">{format(selectedCustomerReports.nextDate, 'dd MMMM yyyy', { locale: tr })}</p>
                 </div>

                 <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Geçmiş Servis Kayıtları</h4>
                 
                 {selectedCustomerReports.reports.length === 0 ? (
                    <p className="text-center py-12 text-slate-400 font-bold italic">Kayıtlı servis raporu bulunmuyor.</p>
                 ) : (
                    <div className="space-y-4">
                      {selectedCustomerReports.reports.map(r => (
                        <div key={r.id} className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-3">
                           <div className="flex justify-between items-center">
                              <span className="text-[9px] font-black text-white px-2 py-0.5 rounded-full bg-slate-400 uppercase">
                                {r.type === 'MAINTENANCE' ? 'Periyodik Bakım' : r.type === 'FAULT' ? 'Arıza Giderim' : 'Kurulum'}
                              </span>
                              <span className="text-[10px] font-bold text-slate-400">
                                {r.completedAt && typeof r.completedAt.toDate === 'function' ? format(r.completedAt.toDate(), 'dd MMM yyyy', { locale: tr }) : ''}
                              </span>
                           </div>
                           <div>
                              <p className="text-xs font-black text-slate-900 uppercase">Yapılan İşlem:</p>
                              <p className="text-sm font-medium text-slate-600 mt-1">{r.description}</p>
                           </div>
                           <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-100">
                              <div>
                                 <p className="text-[8px] font-black text-slate-400 uppercase">Atanan Personel</p>
                                 <p className="text-[11px] font-black text-slate-700">{r.technicianName}</p>
                              </div>
                              <div>
                                 <p className="text-[8px] font-black text-slate-400 uppercase">Sayaç Bilgisi</p>
                                 <p className="text-[11px] font-black text-slate-700">{r.counterReading?.toLocaleString() || 0} Sayfa</p>
                              </div>
                           </div>
                        </div>
                      ))}
                    </div>
                 )}
              </div>
           </motion.div>
        </div>
      )}
    </div>
  );
}

function PaymentFollowUps({ payments, customers }: { payments: PaymentFollowUp[], customers: Customer[] }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentFollowUp | null>(null);

  const sortedPayments = useMemo(() => {
    return [...payments].sort((a,b) => {
      if (a.status === 'PAID' && b.status !== 'PAID') return 1;
      if (a.status !== 'PAID' && b.status === 'PAID') return -1;
      
      const aDate = (a.dueDate && typeof a.dueDate.toDate === 'function') ? a.dueDate.toDate().getTime() : 0;
      const bDate = (b.dueDate && typeof b.dueDate.toDate === 'function') ? b.dueDate.toDate().getTime() : 0;
      
      return aDate - bDate;
    });
  }, [payments]);
  
  const statusLabels: Record<string, string> = {
    'PAID': 'ÖDENDİ',
    'UNPAID': 'BEKLENİYOR',
    'PARTIAL': 'KISMİ ÖDEME'
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Ödeme Takibi</h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Tahsilat planı ve geçmişi</p>
        </div>
        <button onClick={() => setShowAddForm(true)} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm shadow-xl shadow-blue-500/20 uppercase tracking-widest">
           <Plus className="w-5 h-5" /> Kayıt Ekle
        </button>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Müşteri</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Vade Tarihi</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Durum</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Toplam Tutar</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Kalan Borç</th>
                <th className="px-8 py-5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedPayments.map(p => {
                const isOverdue = p.status !== 'PAID' && p.dueDate && typeof p.dueDate.toDate === 'function' && isBefore(p.dueDate.toDate(), new Date());
                const rowClass = p.status === 'PAID' ? 'bg-emerald-50/30' : isOverdue ? 'bg-red-50/30' : 'hover:bg-slate-50';
                
                return (
                  <tr key={p.id} className={`${rowClass} transition-colors group cursor-pointer`} onClick={() => setEditingPayment(p)}>
                    <td className="px-8 py-5">
                      <h4 className="font-black text-slate-900 uppercase leading-none">{p.customerName}</h4>
                    </td>
                    <td className="px-8 py-5">
                      <span className={`text-sm font-bold ${isOverdue ? 'text-red-600' : 'text-slate-600'}`}>
                        {p.dueDate && typeof p.dueDate.toDate === 'function' ? format(p.dueDate.toDate(), 'dd MMM yyyy', { locale: tr }) : 'Belirsiz'}
                        {isOverdue && <span className="ml-2 text-[8px] font-black uppercase text-red-500">Vadesi Geçti</span>}
                      </span>
                    </td>
                    <td className="px-8 py-5 text-center">
                      <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${
                        p.status === 'PAID' ? 'bg-emerald-500 text-white' : 
                        p.status === 'PARTIAL' ? 'bg-amber-400 text-white' : 
                        'bg-slate-200 text-slate-600'
                      }`}>
                         {statusLabels[p.status] || p.status}
                      </span>
                    </td>
                    <td className="px-8 py-5 text-right font-black text-slate-900">
                      ₺{p.totalAmount?.toLocaleString('tr-TR')}
                    </td>
                    <td className="px-8 py-5 text-right font-black text-red-500">
                      ₺{p.remainingAmount?.toLocaleString('tr-TR')}
                    </td>
                    <td className="px-8 py-5 text-right">
                      <button className="p-2 text-slate-300 group-hover:text-blue-600 transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {(showAddForm || editingPayment) && (
        <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6 text-slate-900">
           <PaymentForm 
            onClose={() => { setShowAddForm(false); setEditingPayment(null); }} 
            customers={customers} 
            editingPayment={editingPayment}
           />
        </div>
      )}
    </div>
  );
}

function PaymentForm({ onClose, customers, editingPayment }: { onClose: () => void, customers: Customer[], editingPayment?: PaymentFollowUp | null }) {
  const [formData, setFormData] = useState({
    customerId: editingPayment?.customerId || '',
    totalAmount: editingPayment?.totalAmount || 0,
    paidAmount: editingPayment?.paidAmount || 0,
    dueDate: editingPayment?.dueDate && typeof editingPayment.dueDate.toDate === 'function' ? format(editingPayment.dueDate.toDate(), 'yyyy-MM-dd') : '',
    note: editingPayment?.note || ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const customer = customers.find(c => c.id === formData.customerId);
    if (!customer) return;

    const remaining = formData.totalAmount - formData.paidAmount;
    const status = remaining <= 0 ? 'PAID' : (formData.paidAmount > 0 ? 'PARTIAL' : 'PENDING');

    try {
      if (editingPayment) {
        await updateDoc(doc(db, 'payments', editingPayment.id), {
          ...formData,
          remainingAmount: remaining,
          status,
          dueDate: new Date(formData.dueDate)
        });
      } else {
        await addDoc(collection(db, 'payments'), {
          ...formData,
          customerName: customer.name,
          remainingAmount: remaining,
          status,
          dueDate: new Date(formData.dueDate),
          createdAt: serverTimestamp()
        });
      }
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'payments');
    }
  };

  return (
    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-xl rounded-[2.5rem] shadow-2xl overflow-hidden">
      <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
         <h3 className="text-xl font-black uppercase tracking-tighter">{editingPayment ? 'Ödemeyi Düzenle' : 'Yeni Ödeme Planı'}</h3>
         <button onClick={onClose} className="p-2 text-slate-500 hover:text-white"><Plus className="w-8 h-8 rotate-45" /></button>
      </div>
      <form onSubmit={handleSubmit} className="p-8 space-y-6">
         <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1">
               <label className="text-[10px] font-black text-slate-400 uppercase">Müşteri</label>
               <select required disabled={!!editingPayment} className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" value={formData.customerId} onChange={e => setFormData({...formData, customerId: e.target.value})}>
                  <option value="">Seçiniz</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
               </select>
            </div>
            <div className="space-y-1">
               <label className="text-[10px] font-black text-slate-400 uppercase">Toplam Tutar (TL)</label>
               <input type="number" required className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" value={formData.totalAmount} onChange={e => setFormData({...formData, totalAmount: Number(e.target.value)})} />
            </div>
            <div className="space-y-1">
               <label className="text-[10px] font-black text-slate-400 uppercase">Alınan Ödeme (TL)</label>
               <input type="number" required className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" value={formData.paidAmount} onChange={e => setFormData({...formData, paidAmount: Number(e.target.value)})} />
            </div>
            <div className="col-span-2 space-y-1">
               <label className="text-[10px] font-black text-slate-400 uppercase">Vade Tarihi</label>
               <input type="date" required className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" value={formData.dueDate} onChange={e => setFormData({...formData, dueDate: e.target.value})} />
            </div>
            <div className="col-span-2 space-y-1">
               <label className="text-[10px] font-black text-slate-400 uppercase">Notlar</label>
               <textarea className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold min-h-[80px]" value={formData.note} onChange={e => setFormData({...formData, note: e.target.value})} />
            </div>
         </div>
         <button type="submit" className="w-full py-4 bg-emerald-600 text-white rounded-[2rem] font-black uppercase tracking-widest shadow-lg shadow-emerald-100">Planı Kaydet</button>
      </form>
    </motion.div>
  );
}

function StaffManagement({ technicians, services }: { technicians: UserProfile[], services: ServiceRequest[] }) {
  const [selectedStaff, setSelectedStaff] = useState<UserProfile | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: '', email: '', role: 'TECHNICIAN' as UserRole });

  const staffStats = useMemo(() => {
    return technicians.map(t => {
      const staffServices = services.filter(s => s.technicianId === t.id);
      return {
        ...t,
        pending: staffServices.filter(s => s.status !== 'COMPLETED').length || 0,
        completed: staffServices.filter(s => s.status === 'COMPLETED').length || 0
      };
    });
  }, [technicians, services]);

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const id = Math.random().toString(36).substr(2, 9);
      await setDoc(doc(db, 'users', id), {
        ...newStaff,
        id,
        status: 'ACTIVE',
        createdAt: serverTimestamp()
      });
      setShowAddForm(false);
      setNewStaff({ name: '', email: '', role: 'TECHNICIAN' });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'users');
    }
  };

  const handleDeleteStaff = async (id: string) => {
    if (!window.confirm('Bu personeli silmek istediğinize emin misiniz?')) return;
    try {
      await deleteDoc(doc(db, 'users', id));
      if (selectedStaff?.id === id) setSelectedStaff(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'users');
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Personel Yönetimi</h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Ekip Durumu ve Performans</p>
        </div>
        <button 
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm shadow-xl shadow-blue-500/20 uppercase tracking-widest"
        >
          <Plus className="w-5 h-5" /> Yeni Personel
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {staffStats.map(t => (
          <div 
            key={t.id} 
            className={`bg-white p-6 rounded-3xl border transition-all relative group ${selectedStaff?.id === t.id ? 'border-blue-600 ring-2 ring-blue-100 shadow-md' : 'border-slate-200 hover:shadow-sm'}`}
          >
             <button 
                onClick={(e) => { e.stopPropagation(); handleDeleteStaff(t.id); }}
                className="absolute top-4 right-4 p-2 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
             >
                <Trash2 className="w-4 h-4" />
             </button>
             <div onClick={() => setSelectedStaff(t)} className="flex items-center gap-6 cursor-pointer">
                <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center text-2xl font-black text-blue-600">
                   {t.name.charAt(0)}
                </div>
                <div className="flex-1">
                   <h4 className="font-black text-slate-900 uppercase tracking-tight">{t.name}</h4>
                   <p className="text-[10px] font-bold text-slate-400 uppercase">{t.email}</p>
                   <div className="flex gap-4 mt-2">
                      <div className="text-center">
                         <p className="text-[8px] font-black text-slate-400 uppercase">Aktif İş</p>
                         <p className="text-sm font-black text-blue-600">{t.pending}</p>
                      </div>
                      <div className="text-center">
                         <p className="text-[8px] font-black text-slate-400 uppercase">Biten İş</p>
                         <p className="text-sm font-black text-emerald-600">{t.completed}</p>
                      </div>
                   </div>
                </div>
             </div>
          </div>
        ))}
      </div>

      {showAddForm && (
        <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6 text-slate-900">
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden">
            <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
              <h3 className="text-xl font-black uppercase">Yeni Personel</h3>
              <button onClick={() => setShowAddForm(false)} className="p-2 text-slate-400"><Plus className="w-8 h-8 rotate-45" /></button>
            </div>
            <form onSubmit={handleAddStaff} className="p-8 space-y-6">
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase block mb-1 px-1">Ad Soyad</label>
                  <input required className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" value={newStaff.name} onChange={e => setNewStaff({...newStaff, name: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase block mb-1 px-1">E-posta</label>
                  <input required type="email" className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" value={newStaff.email} onChange={e => setNewStaff({...newStaff, email: e.target.value})} />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase block mb-1 px-1">Rol</label>
                  <select className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" value={newStaff.role} onChange={e => setNewStaff({...newStaff, role: e.target.value as UserRole})}>
                    <option value="TECHNICIAN">Teknisyen</option>
                    <option value="ADMIN">Yönetici</option>
                  </select>
                </div>
              </div>
              <button type="submit" className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-lg">Personeli Kaydet</button>
            </form>
          </motion.div>
        </div>
      )}

      {selectedStaff && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"
        >
          <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">
              {selectedStaff.name} - İş Dağılımı
            </h3>
            <button onClick={() => setSelectedStaff(null)} className="text-[10px] font-bold text-slate-400 uppercase">Kapat</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-100">
            {['PENDING/ASSIGNED', 'IN_PROGRESS/WAITING', 'COMPLETED'].map((group) => {
              const statuses = group.split('/');
              const filtered = services.filter(s => 
                s.technicianId === selectedStaff.id && 
                (statuses.includes(s.status) || (group === 'PENDING/ASSIGNED' && s.status === 'ASSIGNED'))
              );
              
              return (
                <div key={group} className="p-6 space-y-4">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">{group}</h4>
                  <div className="space-y-3">
                    {filtered.length === 0 ? (
                      <p className="text-xs font-bold text-slate-300 italic px-2">Kayıt bulunamadı</p>
                    ) : (
                      filtered.map(s => (
                        <div key={s.id} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm space-y-2">
                           <p className="text-xs font-black text-slate-900 uppercase leading-none">{s.customerName}</p>
                           <p className="text-[10px] font-bold text-slate-400 line-clamp-1">{s.description}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function TechnicianView({ 
  services, 
  view, 
  setView, 
  selectedService, 
  setSelectedService,
  user
}: { 
  services: ServiceRequest[], 
  view: 'LIST' | 'DETAIL' | 'ADMIN' | 'LOGIN', 
  setView: (v: 'LIST' | 'DETAIL' | 'ADMIN' | 'LOGIN') => void,
  selectedService: ServiceRequest | null,
  setSelectedService: (s: ServiceRequest | null) => void,
  user: User
}) {
  const statusLabels: Record<string, string> = {
    'PENDING': 'Beklemede',
    'ASSIGNED': 'Atandı',
    'IN_PROGRESS': 'İşlemde',
    'WAITING_PART': 'Parça Bekliyor',
    'REVISIT_REQUIRED': 'Tekrar Gidilecek',
    'COMPLETED': 'Tamamlandı'
  };

  return (
    <div className="pb-24">
      <header className="bg-slate-900 text-white p-8 space-y-2">
        <div className="flex justify-between items-center">
           <div className="text-[10px] font-black bg-blue-600 px-3 py-1 rounded-full uppercase tracking-widest mb-2 inline-block">Hürmak Servis</div>
           <button onClick={logOut} className="p-2 text-slate-400 hover:text-white transition-colors">
              <LogOut className="w-5 h-5" />
           </button>
        </div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Hoş Geldin, {user.displayName?.split(' ')[0]}</h1>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Bugün yapılacak {services.filter(s => s.status !== 'COMPLETED').length} işin var</p>
      </header>

      <div className="p-6 max-w-2xl mx-auto">
        <AnimatePresence mode="wait">
          {view === 'LIST' ? (
            <motion.div key="list" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-4">
               {services.sort((a,b) => (a.status === 'COMPLETED' ? 1 : -1)).map((s) => (
                 <div 
                  key={s.id} 
                  onClick={() => { setSelectedService(s); setView('DETAIL'); }}
                  className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between group active:scale-[0.98] transition-all"
                 >
                    <div className="space-y-1">
                       <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                        s.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 
                        s.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' : 
                        'bg-slate-100 text-slate-500'
                       }`}>
                          {statusLabels[s.status] || s.status}
                       </span>
                       <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">{s.customerName}</h3>
                       <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          <MapPin className="w-3 h-3" />
                          {s.customerAddress}
                       </div>
                    </div>
                    <ChevronRight className="w-6 h-6 text-slate-300 group-hover:text-slate-900" />
                 </div>
               ))}
            </motion.div>
          ) : (
            <motion.div key="detail" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
               {selectedService && (
                 <JobDetail 
                  service={selectedService} 
                  onBack={() => setView('LIST')} 
                 />
               )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 flex justify-around items-center z-40">
         <button onClick={() => setView('LIST')} className={`p-3 rounded-2xl transition-all ${view === 'LIST' ? 'bg-slate-900 text-white' : 'text-slate-400'}`}>
            <Home className="w-6 h-6" />
         </button>
         <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg shadow-blue-500/40">
            <CheckSquare className="w-6 h-6" />
         </div>
         <button className="p-3 text-slate-400">
            <UserIcon className="w-6 h-6" />
         </button>
      </nav>
    </div>
  );
}

function JobDetail({ service, onBack }: { service: ServiceRequest, onBack: () => void }) {
  const [checklist, setChecklist] = useState(service.checklist);
  const [completing, setCompleting] = useState(false);
  const [reportData, setReportData] = useState({
    counterReading: service.counterReading || 0,
    tonerCountReported: service.tonerCountReported || 0,
    paymentCollected: service.paymentCollected || 0,
    notes: service.notes || ''
  });

  const typeLabels: Record<string, string> = {
    'FAULT': 'Arıza Giderme',
    'MAINTENANCE': 'Periyodik Bakım',
    'INSTALLATION': 'Kurulum'
  };

  const toggleCheck = (id: string) => {
    setChecklist(checklist.map(item => item.id === id ? { ...item, completed: !item.completed } : item));
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await updateDoc(doc(db, 'services', service.id), {
        ...reportData,
        checklist,
        status: 'COMPLETED',
        completedAt: serverTimestamp()
      });

      if (service.customerId) {
        await updateDoc(doc(db, 'customers', service.customerId), {
          lastVisitDate: serverTimestamp()
        });
      }
      onBack();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'services');
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 text-slate-900">
      <button onClick={onBack} className="flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest hover:text-slate-900 transition-colors">
        <ChevronRight className="w-4 h-4 rotate-180" /> Geri Dön
      </button>

      <div className="space-y-4">
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
           <div className="space-y-1">
              <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded uppercase tracking-widest">{typeLabels[service.type] || service.type}</span>
              <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tight leading-tight">{service.customerName}</h2>
              <p className="text-xs font-bold text-slate-400 flex items-center gap-2 mt-2 uppercase tracking-wide">
                 <MapPin className="w-4 h-4" /> {service.customerAddress}
              </p>
           </div>
           
           <div className="p-5 bg-slate-50 rounded-2xl space-y-2 border border-slate-100">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                 <Clock className="w-3.5 h-3.5" /> İş Açıklaması
              </h4>
              <p className="text-sm font-bold text-slate-700 leading-relaxed">{service.description}</p>
           </div>
        </div>

        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
           <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest border-b border-slate-100 pb-4">Servis Kontrol Listesi</h3>
           <div className="space-y-3">
              {checklist.map(item => (
                <button 
                   key={item.id} 
                   onClick={() => toggleCheck(item.id)}
                   className="w-full flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-100 hover:bg-white hover:border-blue-200 transition-all text-left group"
                >
                  <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${item.completed ? 'bg-blue-600 border-blue-600 shadow-lg shadow-blue-200' : 'border-slate-300 bg-white group-hover:border-blue-400'}`}>
                    {item.completed && <CheckCircle2 className="w-4 h-4 text-white" />}
                  </div>
                  <span className={`text-sm font-bold ${item.completed ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{item.label}</span>
                </button>
              ))}
           </div>
        </div>

        {service.status !== 'COMPLETED' && (
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
             <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest border-b border-slate-100 pb-4">Servis Raporu & Sayaç</h3>
             <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Sayaç Bilgisi</label>
                   <input 
                    type="number" 
                    className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" 
                    value={reportData.counterReading}
                    onChange={e => setReportData({...reportData, counterReading: Number(e.target.value)})}
                   />
                </div>
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Kalan Yedek Toner</label>
                   <input 
                    type="number" 
                    className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" 
                    value={reportData.tonerCountReported}
                    onChange={e => setReportData({...reportData, tonerCountReported: Number(e.target.value)})}
                   />
                </div>
                <div className="col-span-2 space-y-2">
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Tahsil Edilen Ödeme (TL)</label>
                   <input 
                    type="number" 
                    className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" 
                    value={reportData.paymentCollected}
                    onChange={e => setReportData({...reportData, paymentCollected: Number(e.target.value)})}
                   />
                </div>
                <div className="col-span-2 space-y-2">
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Teknisyen Notu</label>
                   <textarea 
                    className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-3 text-sm font-bold min-h-[100px]" 
                    value={reportData.notes}
                    onChange={e => setReportData({...reportData, notes: e.target.value})}
                   />
                </div>
             </div>
          </div>
        )}

        <button 
          onClick={handleComplete}
          disabled={completing || service.status === 'COMPLETED'}
          className={`w-full py-5 rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-2xl transition-all active:scale-95 disabled:opacity-50 ${service.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-600 text-white shadow-blue-500/30 hover:bg-blue-700'}`}
        >
          {completing ? 'Kaydediliyor...' : service.status === 'COMPLETED' ? 'İş Tamamlandı' : 'Servis Formunu Tamamla'}
        </button>
      </div>
    </div>
  );
}

function AuthView() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-slate-900">
      <div className="w-full max-w-sm text-center space-y-12">
        <div className="space-y-4">
          <div className="mx-auto w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center shadow-xl shadow-slate-200">
             <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center font-bold text-xs italic text-white leading-none">Hürmak</div>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Hürmak MOBİL</h1>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-widest">Saha Servis Yönetimi</p>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          {[
            { icon: Camera, label: 'Fotoğraf' },
            { icon: CheckSquare, label: 'İmza' },
            { icon: ClipboardCheck, label: 'Checklist' },
            { icon: MapPin, label: 'Konum' }
          ].map((feature, i) => (
            <div key={i} className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col items-center gap-3">
              <div className="w-10 h-10 bg-slate-50 rounded-lg flex items-center justify-center text-blue-600">
                <feature.icon className="w-6 h-6" />
              </div>
              <span className="text-xs font-bold text-slate-600 uppercase tracking-tight">{feature.label}</span>
            </div>
          ))}
        </div>

        <button
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-blue-600 text-white rounded-xl font-bold text-sm shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95 uppercase tracking-widest"
        >
          Google Hesabı ile Başla
        </button>
      </div>
    </div>
  );
}

