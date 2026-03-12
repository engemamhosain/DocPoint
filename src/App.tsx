/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, Component } from 'react';
import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy,
  Timestamp,
  addDoc,
  updateDoc
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile, DoctorProfile, Appointment, Clinic, UserRole } from './types';
import { cn } from './lib/utils';
import { 
  Calendar, 
  Clock, 
  User, 
  LogOut, 
  Search, 
  Stethoscope, 
  MapPin, 
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertCircle
} from 'lucide-react';
import { format, addDays, startOfToday, isAfter } from 'date-fns';

// --- Error Handling ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: string;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorInfo: '' };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#f5f5f0] p-6">
          <Card className="max-w-md w-full text-center">
            <AlertCircle className="mx-auto text-red-500 mb-4" size={48} />
            <h2 className="text-2xl font-serif mb-2">Something went wrong</h2>
            <p className="text-gray-600 mb-6">We encountered an error while processing your request.</p>
            <div className="bg-red-50 p-4 rounded-xl text-left mb-6 overflow-auto max-h-40">
              <code className="text-xs text-red-700">{this.state.errorInfo}</code>
            </div>
            <Button onClick={() => window.location.reload()} className="w-full">
              Reload Application
            </Button>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

const Button = ({ 
  className, 
  variant = 'primary', 
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost' }) => {
  const variants = {
    primary: 'bg-[#5A5A40] text-white hover:bg-[#4A4A30]',
    secondary: 'bg-white text-[#5A5A40] border border-[#5A5A40] hover:bg-[#f5f5f0]',
    outline: 'border border-gray-200 text-gray-600 hover:bg-gray-50',
    ghost: 'text-gray-600 hover:bg-gray-100'
  };
  return (
    <button 
      className={cn('px-4 py-2 rounded-full font-medium transition-all duration-200 disabled:opacity-50', variants[variant], className)} 
      {...props} 
    />
  );
};

const Card = ({ children, className, ...props }: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('bg-white rounded-3xl p-6 shadow-sm border border-gray-100', className)} {...props}>
    {children}
  </div>
);

// --- Main App ---

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'patient' | 'doctor' | 'admin'>('patient');
  const [doctors, setDoctors] = useState<DoctorProfile[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorProfile | null>(null);
  const [bookingDate, setBookingDate] = useState<Date>(startOfToday());
  const [bookingTime, setBookingTime] = useState<string>('09:00');

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          setProfile(userDoc.data() as UserProfile);
          setView(userDoc.data().role);
        } else {
          // New user setup
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || 'User',
            role: 'patient',
            photoURL: firebaseUser.photoURL || undefined,
            createdAt: Timestamp.now()
          };
          await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
          setProfile(newProfile);
          setView('patient');
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Fetch Doctors
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'doctors'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docsData = snapshot.docs.map(doc => doc.data() as DoctorProfile);
      setDoctors(docsData);
    });
    return unsubscribe;
  }, [user]);

  // Fetch Appointments
  useEffect(() => {
    if (!profile) return;
    const field = profile.role === 'patient' ? 'patientId' : 'doctorId';
    const q = query(
      collection(db, 'appointments'), 
      where(field, '==', profile.uid),
      orderBy('dateTime', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const apps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Appointment));
      setAppointments(apps);
    });
    return unsubscribe;
  }, [profile]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = () => signOut(auth);

  const switchRole = async (newRole: UserRole) => {
    if (!profile) return;
    try {
      await updateDoc(doc(db, 'users', profile.uid), { role: newRole });
      setProfile({ ...profile, role: newRole });
      setView(newRole);
      
      // If switching to doctor, ensure doctor profile exists
      if (newRole === 'doctor') {
        const docRef = doc(db, 'doctors', profile.uid);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
          await setDoc(docRef, {
            uid: profile.uid,
            specialty: 'General Practitioner',
            clinicId: 'clinic-1',
            displayName: profile.displayName,
            photoURL: profile.photoURL
          });
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${profile.uid}`);
    }
  };

  const seedData = async () => {
    if (doctors.length > 0) return;
    const sampleDoctors = [
      { uid: 'doc-1', displayName: 'Sarah Jenkins', specialty: 'Cardiology', clinicId: 'clinic-1' },
      { uid: 'doc-2', displayName: 'Michael Chen', specialty: 'Pediatrics', clinicId: 'clinic-1' },
      { uid: 'doc-3', displayName: 'Elena Rodriguez', specialty: 'Dermatology', clinicId: 'clinic-1' }
    ];
    for (const d of sampleDoctors) {
      await setDoc(doc(db, 'doctors', d.uid), d);
    }
  };

  useEffect(() => {
    if (doctors.length === 0 && user) seedData();
  }, [doctors, user]);

  const handleBookAppointment = async () => {
    if (!profile || !selectedDoctor) return;
    
    const [hours, minutes] = bookingTime.split(':').map(Number);
    const appointmentDate = new Date(bookingDate);
    appointmentDate.setHours(hours, minutes, 0, 0);

    if (!isAfter(appointmentDate, new Date())) {
      alert('Please select a future date and time.');
      return;
    }

    const newAppointment: Omit<Appointment, 'id'> = {
      patientId: profile.uid,
      doctorId: selectedDoctor.uid,
      clinicId: selectedDoctor.clinicId,
      dateTime: Timestamp.fromDate(appointmentDate),
      status: 'pending',
      createdAt: Timestamp.now(),
      doctorName: selectedDoctor.displayName,
    };

    try {
      await addDoc(collection(db, 'appointments'), newAppointment);
      setSelectedDoctor(null);
      alert('Appointment booked successfully!');
    } catch (error) {
      console.error('Booking failed', error);
    }
  };

  const updateAppointmentStatus = async (id: string, status: Appointment['status']) => {
    try {
      await updateDoc(doc(db, 'appointments', id), { status });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `appointments/${id}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f0]">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 bg-[#5A5A40] rounded-full mb-4"></div>
          <p className="text-[#5A5A40] font-serif italic">Loading DocPoint...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="mb-8 flex justify-center">
            <div className="w-16 h-16 bg-[#5A5A40] rounded-2xl flex items-center justify-center text-white">
              <Stethoscope size={32} />
            </div>
          </div>
          <h1 className="text-5xl font-serif mb-4 text-[#1a1a1a]">DocPoint</h1>
          <p className="text-lg text-gray-600 mb-8 font-serif italic">
            Your health, simplified. Book appointments with top specialists in seconds.
          </p>
          <Button onClick={handleLogin} className="w-full py-4 text-lg">
            Sign in with Google
          </Button>
          <p className="mt-6 text-sm text-gray-400">
            By signing in, you agree to our Terms of Service.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] text-[#1a1a1a] font-sans">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-30 border-bottom border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#5A5A40] rounded-xl flex items-center justify-center text-white">
              <Stethoscope size={20} />
            </div>
            <span className="text-2xl font-serif font-bold tracking-tight">DocPoint</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-full border border-gray-100">
              <User size={14} className="text-gray-400" />
              <span className="text-sm font-medium">{profile?.displayName}</span>
              <select 
                value={profile?.role} 
                onChange={(e) => switchRole(e.target.value as UserRole)}
                className="text-[10px] uppercase tracking-wider bg-[#5A5A40] text-white px-2 py-0.5 rounded-full border-none focus:ring-0 cursor-pointer"
              >
                <option value="patient">Patient</option>
                <option value="doctor">Doctor</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <Button variant="ghost" onClick={handleLogout} className="p-2">
              <LogOut size={20} />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {profile?.role === 'patient' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            {/* Left: Find Doctors */}
            <div className="lg:col-span-2 space-y-8">
              <section>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-3xl font-serif">Find a Specialist</h2>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="text" 
                      placeholder="Search specialty..." 
                      className="pl-10 pr-4 py-2 bg-white rounded-full border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 w-64"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {doctors.length > 0 ? doctors.map((doc) => (
                    <Card key={doc.uid} className="hover:shadow-md transition-shadow cursor-pointer group" >
                      <div className="flex gap-4">
                        <div className="w-16 h-16 bg-gray-100 rounded-2xl overflow-hidden flex-shrink-0">
                          <img 
                            src={doc.photoURL || `https://picsum.photos/seed/${doc.uid}/200`} 
                            alt={doc.displayName} 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-bold text-lg group-hover:text-[#5A5A40] transition-colors">Dr. {doc.displayName || 'Specialist'}</h3>
                          <p className="text-sm text-[#5A5A40] font-medium">{doc.specialty}</p>
                          <div className="flex items-center gap-1 mt-2 text-xs text-gray-500">
                            <MapPin size={12} />
                            <span>Central Clinic</span>
                          </div>
                        </div>
                      </div>
                      <Button 
                        onClick={() => setSelectedDoctor(doc)}
                        className="w-full mt-6"
                        variant="secondary"
                      >
                        Book Appointment
                      </Button>
                    </Card>
                  )) : (
                    <div className="col-span-full py-12 text-center text-gray-400 italic font-serif">
                      No doctors available at the moment.
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Right: My Appointments */}
            <div className="space-y-8">
              <section>
                <h2 className="text-2xl font-serif mb-6">My Appointments</h2>
                <div className="space-y-4">
                  {appointments.length > 0 ? appointments.map((app) => (
                    <Card key={app.id} className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-xs uppercase tracking-widest text-gray-400 font-bold mb-1">
                            {format(app.dateTime.toDate(), 'MMM d, yyyy')}
                          </p>
                          <h4 className="font-bold">Dr. {app.doctorName || 'Specialist'}</h4>
                        </div>
                        <span className={cn(
                          "text-[10px] uppercase font-bold px-2 py-1 rounded-md",
                          app.status === 'confirmed' ? "bg-green-100 text-green-700" :
                          app.status === 'pending' ? "bg-yellow-100 text-yellow-700" :
                          "bg-red-100 text-red-700"
                        )}>
                          {app.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Clock size={14} />
                        <span>{format(app.dateTime.toDate(), 'h:mm a')}</span>
                      </div>
                    </Card>
                  )) : (
                    <div className="py-8 text-center text-gray-400 italic font-serif border-2 border-dashed border-gray-200 rounded-3xl">
                      No upcoming appointments.
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        ) : (
          /* Doctor View */
          <div className="space-y-12">
            <section>
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-4xl font-serif mb-2">Patient Schedule</h2>
                  <p className="text-gray-500 italic font-serif">Manage your upcoming consultations</p>
                </div>
                <div className="flex gap-4">
                  <div className="text-right">
                    <p className="text-sm text-gray-400 uppercase tracking-widest font-bold">Today</p>
                    <p className="text-xl font-serif">{format(new Date(), 'EEEE, MMM d')}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {appointments.length > 0 ? appointments.map((app) => (
                  <Card key={app.id} className="flex items-center justify-between hover:border-[#5A5A40]/30 transition-colors">
                    <div className="flex items-center gap-6">
                      <div className="w-12 h-12 bg-[#f5f5f0] rounded-2xl flex items-center justify-center text-[#5A5A40]">
                        <Clock size={24} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-[#5A5A40]">{format(app.dateTime.toDate(), 'h:mm a')}</p>
                        <h4 className="text-lg font-serif">Patient ID: {app.patientId.slice(0, 8)}...</h4>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      {app.status === 'pending' && (
                        <>
                          <Button 
                            variant="ghost" 
                            className="text-green-600 hover:bg-green-50"
                            onClick={() => updateAppointmentStatus(app.id, 'confirmed')}
                          >
                            <CheckCircle2 size={24} />
                          </Button>
                          <Button 
                            variant="ghost" 
                            className="text-red-600 hover:bg-red-50"
                            onClick={() => updateAppointmentStatus(app.id, 'cancelled')}
                          >
                            <XCircle size={24} />
                          </Button>
                        </>
                      )}
                      {app.status === 'confirmed' && (
                        <div className="flex items-center gap-2 text-green-600 font-medium px-4 py-2 bg-green-50 rounded-full">
                          <CheckCircle2 size={18} />
                          <span>Confirmed</span>
                        </div>
                      )}
                      {app.status === 'cancelled' && (
                        <div className="flex items-center gap-2 text-red-600 font-medium px-4 py-2 bg-red-50 rounded-full">
                          <XCircle size={18} />
                          <span>Cancelled</span>
                        </div>
                      )}
                    </div>
                  </Card>
                )) : (
                  <div className="py-20 text-center text-gray-400 italic font-serif border-2 border-dashed border-gray-200 rounded-3xl">
                    No appointments scheduled yet.
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Booking Modal */}
      {selectedDoctor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm">
          <Card className="max-w-md w-full animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-start mb-6">
              <h3 className="text-2xl font-serif">Book Appointment</h3>
              <Button variant="ghost" onClick={() => setSelectedDoctor(null)} className="p-1">
                <XCircle size={24} />
              </Button>
            </div>
            
            <div className="flex items-center gap-4 mb-8 p-4 bg-[#f5f5f0] rounded-2xl">
              <div className="w-12 h-12 bg-white rounded-xl overflow-hidden">
                <img 
                  src={selectedDoctor.photoURL || `https://picsum.photos/seed/${selectedDoctor.uid}/200`} 
                  alt={selectedDoctor.displayName}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div>
                <p className="font-bold">Dr. {selectedDoctor.displayName}</p>
                <p className="text-xs text-[#5A5A40] uppercase tracking-widest font-bold">{selectedDoctor.specialty}</p>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">Select Date</label>
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {[0, 1, 2, 3, 4, 5, 6].map((offset) => {
                    const date = addDays(startOfToday(), offset);
                    const isSelected = format(date, 'yyyy-MM-dd') === format(bookingDate, 'yyyy-MM-dd');
                    return (
                      <button
                        key={offset}
                        onClick={() => setBookingDate(date)}
                        className={cn(
                          "flex flex-col items-center min-w-[64px] p-3 rounded-2xl transition-all",
                          isSelected ? "bg-[#5A5A40] text-white shadow-lg" : "bg-white border border-gray-100 hover:bg-gray-50"
                        )}
                      >
                        <span className="text-[10px] uppercase font-bold opacity-70">{format(date, 'EEE')}</span>
                        <span className="text-lg font-serif font-bold">{format(date, 'd')}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">Select Time</label>
                <div className="grid grid-cols-3 gap-2">
                  {['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'].map((time) => (
                    <button
                      key={time}
                      onClick={() => setBookingTime(time)}
                      className={cn(
                        "py-2 rounded-xl text-sm font-medium transition-all",
                        bookingTime === time ? "bg-[#5A5A40] text-white" : "bg-white border border-gray-100 hover:bg-gray-50"
                      )}
                    >
                      {time}
                    </button>
                  ))}
                </div>
              </div>

              <Button onClick={handleBookAppointment} className="w-full py-4 mt-4">
                Confirm Booking
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-gray-100 py-12 mt-20">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <div className="flex justify-center mb-6">
            <div className="w-8 h-8 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400">
              <Stethoscope size={16} />
            </div>
          </div>
          <p className="text-gray-400 text-sm font-serif italic">© 2026 DocPoint SaaS. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
