export type UserRole = 'patient' | 'doctor' | 'admin';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  photoURL?: string;
  createdAt: any;
}

export interface DoctorProfile {
  uid: string;
  specialty: string;
  bio?: string;
  clinicId: string;
  experience?: number;
  rating?: number;
  displayName?: string; // Denormalized for ease
  photoURL?: string; // Denormalized for ease
}

export interface Clinic {
  id: string;
  name: string;
  address: string;
  phone?: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  dateTime: any;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  notes?: string;
  createdAt: any;
  doctorName?: string; // Denormalized
  clinicName?: string; // Denormalized
}
