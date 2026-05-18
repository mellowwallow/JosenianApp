import { Injectable } from '@angular/core';
import { FirebaseService } from './firebase.service';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  Auth,
  User,
  onAuthStateChanged,
  AuthError,
  getAuth,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { initializeApp, getApps } from 'firebase/app';
import { environment } from '../../environments/environment';
import { getDoc, setDoc, doc, Firestore, collection, query, where, getDocs, deleteDoc, updateDoc, addDoc, increment, orderBy, limit, writeBatch, arrayUnion, arrayRemove } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, FirebaseStorage } from 'firebase/storage';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth: Auth;
  private firestore: Firestore;
  private storage: FirebaseStorage;
  private currentUserSubject: BehaviorSubject<User | null>;
  public currentUser$: Observable<User | null>;

  constructor(private firebaseService: FirebaseService) {
    this.auth = firebaseService.getAuth();
    this.firestore = firebaseService.getFirestore();
    this.storage = firebaseService.getStorage();
    this.currentUserSubject = new BehaviorSubject<User | null>(null);
    this.currentUser$ = this.currentUserSubject.asObservable();


    onAuthStateChanged(this.auth, (user: User | null) => {
      this.currentUserSubject.next(user);
      console.log('User auth state changed:', user?.email);
    });
  }




  async registerWithProfile(
    email: string,
    password: string,
    profileData: {
      firstName: string;
      lastName: string;
      middleName?: string;
      birthdate?: string;
      userType: 'student' | 'alumni';
      studentNumber?: string;
      department: string;
      course?: string;
      graduationYear?: string;
      alumniIdFile?: File;
      alumniGradPhotoFile?: File;
      alumniIdFileName?: string;
      alumniIdVerificationStatus?: string;
    }
  ): Promise<any> {
    try {
      const result = await createUserWithEmailAndPassword(this.auth, email, password);
      const uid = result.user.uid;

      const userData: any = {
        email: email,
        firstName: profileData.firstName,
        lastName: profileData.lastName,
        middleName: profileData.middleName || '',
        birthdate: profileData.birthdate || '',
        userType: profileData.userType,
        studentNumber: profileData.studentNumber || '',
        department: profileData.department,
        course: profileData.course || '',
        graduationYear: profileData.graduationYear || '',
        role: 'user',
        status: 'pending',
        createdAt: new Date(),
        joinDate: new Date().toISOString().split('T')[0],
      };

      if (profileData.alumniIdFile && profileData.alumniGradPhotoFile) {
        const [alumniIdUrl, alumniGradPhotoUrl] = await Promise.all([
          this.uploadFile(`alumni-ids/${uid}/alumni-id`, profileData.alumniIdFile),
          this.uploadFile(`alumni-ids/${uid}/grad-photo`, profileData.alumniGradPhotoFile),
        ]);
        userData.alumniIdUrl = alumniIdUrl;
        userData.alumniIdFileName = profileData.alumniIdFileName || '';
        userData.alumniGradPhotoUrl = alumniGradPhotoUrl;
        userData.alumniIdVerificationStatus = profileData.alumniIdVerificationStatus || 'pending';
      }


      await setDoc(doc(this.firestore, 'users', uid), userData);


      await this.addMemberToDepartment(
        profileData.department,
        uid,
        {
          name: `${profileData.firstName} ${profileData.lastName}`,
          email: email,
          userType: profileData.userType,
          role: profileData.userType === 'student' ? 'student' : 'alumni',
          studentNumber: profileData.studentNumber || '',
          course: profileData.course || '',
          joinedDate: new Date().toISOString().split('T')[0],
        }
      );
      
      return result;
    } catch (error) {
      throw this.handleAuthError(error as AuthError);
    }
  }


  async register(email: string, password: string): Promise<any> {
    try {
      const result = await createUserWithEmailAndPassword(this.auth, email, password);
      

      await setDoc(doc(this.firestore, 'users', result.user.uid), {
        email: email,
        role: 'user',
        status: 'pending',
        createdAt: new Date(),
        displayName: '',
      });
      
      return result;
    } catch (error) {
      throw this.handleAuthError(error as AuthError);
    }
  }


  async login(email: string, password: string): Promise<any> {
    try {
      const result = await signInWithEmailAndPassword(this.auth, email, password);
      

      const userDoc = await getDoc(doc(this.firestore, 'users', result.user.uid));
      if (!userDoc.exists()) {

        await setDoc(doc(this.firestore, 'users', result.user.uid), {
          email: email,
          role: 'user',
          status: 'pending',
          createdAt: new Date(),
          displayName: '',
        });
      }
      

      const userData = userDoc.exists() ? userDoc.data() : await getDoc(doc(this.firestore, 'users', result.user.uid)).then(d => d.data());
      const userStatus = userData?.['status'] || 'pending';
      
      if (userStatus === 'pending') {
        await signOut(this.auth);
        throw new Error('Your account is pending admin approval. Please check back later.');
      }
      
      if (userStatus === 'rejected') {
        await signOut(this.auth);
        throw new Error('Your account registration was not approved. Please contact the administrator.');
      }
      
      return result;
    } catch (error) {
      throw this.handleAuthError(error as AuthError);
    }
  }


  async adminLogin(email: string, password: string): Promise<any> {
    try {
      const result = await signInWithEmailAndPassword(this.auth, email, password);
      

      const userDoc = await getDoc(doc(this.firestore, 'users', result.user.uid));
      
      if (!userDoc.exists()) {
        await signOut(this.auth);
        throw new Error('User not found in system');
      }
      
      const userData = userDoc.data();
      if (userData['role'] !== 'admin') {
        await signOut(this.auth);
        throw new Error('Unauthorized: Admin access required');
      }
      
      return result;
    } catch (error) {
      throw this.handleAuthError(error as AuthError);
    }
  }




  async getPendingUsers(): Promise<any[]> {
    try {
      const q = query(
        collection(this.firestore, 'users'),
        where('status', '==', 'pending')
      );
      
      const querySnapshot = await getDocs(q);
      const users: any[] = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        users.push({
          id: doc.id,
          name: `${data['firstName']} ${data['lastName']}`,
          email: data['email'],
          type: data['userType'] === 'student' ? 'Student' : 'Alumni',
          joinDate: data['joinDate'] || new Date().toISOString().split('T')[0],
          department: data['department'],
          studentNumber: data['studentNumber'] || '',
          course: data['course'] || '',
          ...data
        });
      });
      
      return users;
    } catch (error) {
      console.error('Error fetching pending users:', error);
      return [];
    }
  }


  async getAllUsers(): Promise<any[]> {
    try {
      const q = query(collection(this.firestore, 'users'));
      const querySnapshot = await getDocs(q);
      const users: any[] = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        users.push({
          id: doc.id,
          status: data['status'] || 'pending',
          ...data
        });
      });
      
      return users;
    } catch (error) {
      console.error('Error fetching all users:', error);
      return [];
    }
  }




  async getDepartments(): Promise<any[]> {
    try {
      const querySnapshot = await getDocs(collection(this.firestore, 'departments'));
      const departments: any[] = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        departments.push({
          id: doc.id,
          name: data['name'],
          color: data['color'] || '',
          courses: data['courses'] || [],
          members: data['members'] || [],
          createdAt: data['createdAt']
        });
      });
      

      departments.sort((a, b) => a.name.localeCompare(b.name));
      
      return departments;
    } catch (error) {
      console.error('Error fetching departments:', error);
      return [];
    }
  }


  async addDepartment(departmentName: string, color: string = '#1E5128'): Promise<any> {
    try {
      const docRef = await addDoc(collection(this.firestore, 'departments'), {
        name: departmentName,
        color,
        courses: [],
        members: [],
        createdAt: new Date()
      });
      
      console.log('Department added with ID:', docRef.id);
      return {
        id: docRef.id,
        name: departmentName,
        color,
        courses: [],
        members: []
      };
    } catch (error) {
      console.error('Error adding department:', error);
      throw error;
    }
  }


  async updateDepartment(departmentId: string, newName: string, color?: string): Promise<void> {
    const updateData: any = { name: newName };
    if (color) updateData.color = color;
    await updateDoc(doc(this.firestore, 'departments', departmentId), updateData);
  }


  async deleteDepartment(departmentId: string): Promise<void> {
    try {
      await deleteDoc(doc(this.firestore, 'departments', departmentId));
      console.log('Department deleted:', departmentId);
    } catch (error) {
      console.error('Error deleting department:', error);
      throw error;
    }
  }


  async addCourse(departmentId: string, courseName: string): Promise<void> {
    try {
      const deptRef = doc(this.firestore, 'departments', departmentId);
      const deptDoc = await getDoc(deptRef);
      
      if (deptDoc.exists()) {
        const courses = deptDoc.data()['courses'] || [];
        courses.push(courseName);
        
        await updateDoc(deptRef, {
          courses: courses
        });
        console.log('Course added to department:', departmentId);
      }
    } catch (error) {
      console.error('Error adding course:', error);
      throw error;
    }
  }


  async updateCourse(departmentId: string, courseIndex: number, newName: string): Promise<void> {
    const deptRef = doc(this.firestore, 'departments', departmentId);
    const deptDoc = await getDoc(deptRef);
    if (deptDoc.exists()) {
      const courses: string[] = deptDoc.data()['courses'] || [];
      courses[courseIndex] = newName;
      await updateDoc(deptRef, { courses });
    }
  }


  async deleteCourse(departmentId: string, courseIndex: number): Promise<void> {
    try {
      const deptRef = doc(this.firestore, 'departments', departmentId);
      const deptDoc = await getDoc(deptRef);
      
      if (deptDoc.exists()) {
        const courses = deptDoc.data()['courses'] || [];
        courses.splice(courseIndex, 1);
        
        await updateDoc(deptRef, {
          courses: courses
        });
        console.log('Course deleted from department:', departmentId);
      }
    } catch (error) {
      console.error('Error deleting course:', error);
      throw error;
    }
  }


  async getCoursesByDepartment(departmentId: string): Promise<string[]> {
    try {
      const deptDoc = await getDoc(doc(this.firestore, 'departments', departmentId));
      if (deptDoc.exists()) {
        return deptDoc.data()['courses'] || [];
      }
      return [];
    } catch (error) {
      console.error('Error fetching courses:', error);
      return [];
    }
  }


  async addMemberToDepartment(
    departmentId: string,
    userId: string,
    memberData: {
      name: string;
      email: string;
      userType: 'student' | 'alumni';
      role: 'student' | 'alumni';
      studentNumber?: string;
      course?: string;
      joinedDate: string;
    }
  ): Promise<void> {
    try {
      const deptRef = doc(this.firestore, 'departments', departmentId);
      const deptDoc = await getDoc(deptRef);
      
      if (deptDoc.exists()) {
        const members = deptDoc.data()['members'] || [];
        

        const memberExists = members.some((m: any) => m.userId === userId);
        
        if (!memberExists) {
          members.push({
            userId: userId,
            name: memberData.name,
            email: memberData.email,
            userType: memberData.userType,
            role: memberData.role,
            studentNumber: memberData.studentNumber || '',
            course: memberData.course || '',
            joinedDate: memberData.joinedDate,
          });
          
          await updateDoc(deptRef, { members: members });
          console.log('User added as member to department:', departmentId);
        }
      } else {
        console.warn('Department not found:', departmentId);
      }
    } catch (error) {
      console.error('Error adding member to department:', error);
      throw error;
    }
  }


  async getDepartmentMembers(departmentId: string): Promise<any[]> {
    try {
      const deptDoc = await getDoc(doc(this.firestore, 'departments', departmentId));
      if (deptDoc.exists()) {
        return deptDoc.data()['members'] || [];
      }
      return [];
    } catch (error) {
      console.error('Error fetching department members:', error);
      return [];
    }
  }


  async removeMemberFromDepartment(departmentId: string, userId: string): Promise<void> {
    try {
      const deptRef = doc(this.firestore, 'departments', departmentId);
      const deptDoc = await getDoc(deptRef);
      
      if (deptDoc.exists()) {
        const members = deptDoc.data()['members'] || [];
        const filteredMembers = members.filter((m: any) => m.userId !== userId);
        
        await updateDoc(deptRef, { members: filteredMembers });
        console.log('User removed from department:', departmentId);
      }
    } catch (error) {
      console.error('Error removing member from department:', error);
      throw error;
    }
  }



  async adminCreateUser(
    email: string,
    profileData: {
      firstName: string;
      lastName: string;
      userType: 'student' | 'alumni';
      role?: string;
      studentNumber?: string;
      department: string;
      course?: string;
      graduationYear?: string;
    }
  ): Promise<string> {
    const appName = 'adminUserCreation';
    const existing = getApps().find(a => a.name === appName);
    const secondaryApp = existing || initializeApp(environment.firebase, appName);
    const secondaryAuth = getAuth(secondaryApp);
    const tempPassword = this.generateTempPassword();

    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword);
      const uid = cred.user.uid;

      await setDoc(doc(this.firestore, 'users', uid), {
        email,
        firstName: profileData.firstName,
        lastName: profileData.lastName,
        userType: profileData.userType,
        studentNumber: profileData.studentNumber || '',
        department: profileData.department,
        course: profileData.course || '',
        graduationYear: profileData.graduationYear || '',
        role: profileData.role || 'user',
        status: 'approved',
        createdAt: new Date(),
        joinDate: new Date().toISOString().split('T')[0],
        createdByAdmin: true,
      });

      await this.addMemberToDepartment(profileData.department, uid, {
        name: `${profileData.firstName} ${profileData.lastName}`,
        email,
        userType: profileData.userType,
        role: profileData.userType,
        studentNumber: profileData.studentNumber || '',
        course: profileData.course || '',
        joinedDate: new Date().toISOString().split('T')[0],
      });

      await signOut(secondaryAuth);
      await sendPasswordResetEmail(this.auth, email);

      return uid;
    } catch (error) {
      await signOut(secondaryAuth).catch(() => {});
      throw error;
    }
  }

  private generateTempPassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }






  async getAlumni(): Promise<any[]> {
    try {
      const alumniList: any[] = [];
      

      const q = query(collection(this.firestore, 'users'));
      
      const querySnapshot = await getDocs(q);
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const userType = data['userType'];
        if (userType !== 'student' && userType !== 'alumni') return;

        alumniList.push({
          id: doc.id,
          studentNumber: data['studentNumber'] || '',
          name: `${data['firstName'] || ''} ${data['lastName'] || ''}`.trim(),
          email: data['email'] || '',
          department: data['department'] || '',
          course: data['course'] || '',
          batch: data['graduationYear'] || '',
          contactNumber: data['contactNumber'] || '',
          gender: data['gender'] || '',
          address: data['address'] || '',
          userType,
          status: data['status'],
          role: data['role'] || 'user',
          createdAt: data['createdAt'],
          source: 'registered',
          workExperiences: data['workExperiences'] || []
        });
      });


      try {
        const manualAlumniSnapshot = await getDocs(collection(this.firestore, 'alumni'));
        manualAlumniSnapshot.forEach((doc) => {
          const data = doc.data();
          alumniList.push({
            id: doc.id,
            studentNumber: data['studentNumber'] || '',
            name: data['name'] || '',
            email: data['email'] || '',
            department: data['department'] || '',
            course: data['course'] || '',
            batch: data['batch'] || '',
            userType: 'alumni',
            createdAt: data['createdAt'],
            source: 'manual'
          });
        });
      } catch (error) {

        console.log('Alumni collection not found or empty');
      }
      

      alumniList.sort((a, b) => {
        const batchA = parseInt(a.batch) || 0;
        const batchB = parseInt(b.batch) || 0;
        const batchDiff = batchB - batchA;
        if (batchDiff !== 0) return batchDiff;
        return a.name.localeCompare(b.name);
      });
      
      return alumniList;
    } catch (error) {
      console.error('Error fetching alumni:', error);
      return [];
    }
  }


  async addAlumni(alumniData: any): Promise<any> {
    try {
      const docRef = await addDoc(collection(this.firestore, 'alumni'), {
        studentNumber: alumniData.studentNumber,
        name: alumniData.name,
        email: alumniData.email,
        department: alumniData.department,
        course: alumniData.course,
        batch: alumniData.batch,
        userType: 'alumni',
        createdAt: new Date()
      });
      
      console.log('Alumni added with ID:', docRef.id);
      return {
        id: docRef.id,
        ...alumniData,
        userType: 'alumni'
      };
    } catch (error) {
      console.error('Error adding alumni:', error);
      throw error;
    }
  }


  async updateAlumni(alumniId: string, alumniData: any): Promise<void> {
    try {
      await updateDoc(doc(this.firestore, 'alumni', alumniId), {
        studentNumber: alumniData.studentNumber,
        name: alumniData.name,
        email: alumniData.email,
        department: alumniData.department,
        course: alumniData.course,
        batch: alumniData.batch,
        updatedAt: new Date()
      });
      console.log('Alumni updated:', alumniId);
    } catch (error) {
      console.error('Error updating alumni:', error);
      throw error;
    }
  }


  async deleteAlumni(alumniId: string): Promise<void> {
    try {
      await deleteDoc(doc(this.firestore, 'alumni', alumniId));
      console.log('Alumni deleted:', alumniId);
    } catch (error) {
      console.error('Error deleting alumni:', error);
      throw error;
    }
  }


  async deleteRegisteredUser(userId: string): Promise<void> {
    const userSnap = await getDoc(doc(this.firestore, 'users', userId));
    const departmentId: string = userSnap.data()?.['department'] || '';
    if (departmentId) {
      await this.removeMemberFromDepartment(departmentId, userId);
    }
    await deleteDoc(doc(this.firestore, 'users', userId));
  }


  async searchAlumni(searchTerm: string): Promise<any[]> {
    try {
      const allAlumni = await this.getAlumni();
      return allAlumni.filter(a => 
        a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.studentNumber.toLowerCase().includes(searchTerm.toLowerCase())
      );
    } catch (error) {
      console.error('Error searching alumni:', error);
      return [];
    }
  }


  async getAlumniByDepartment(department: string): Promise<any[]> {
    try {
      const allAlumni = await this.getAlumni();
      return allAlumni.filter(a => a.department === department);
    } catch (error) {
      console.error('Error fetching alumni by department:', error);
      return [];
    }
  }


  async getAlumniByBatch(batch: string): Promise<any[]> {
    try {
      const allAlumni = await this.getAlumni();
      return allAlumni.filter(a => a.batch === batch);
    } catch (error) {
      console.error('Error fetching alumni by batch:', error);
      return [];
    }
  }




  async isAdmin(): Promise<boolean> {
    const user = this.currentUserSubject.value;
    if (!user) return false;
    
    try {
      const userDoc = await getDoc(doc(this.firestore, 'users', user.uid));
      return userDoc.exists() && userDoc.data()['role'] === 'admin';
    } catch (error) {
      console.error('Error checking admin status:', error);
      return false;
    }
  }


  async getUserRole(uid: string): Promise<string> {
    try {
      const userDoc = await getDoc(doc(this.firestore, 'users', uid));
      return userDoc.exists() ? userDoc.data()['role'] : 'user';
    } catch (error) {
      console.error('Error getting user role:', error);
      return 'user';
    }
  }


  async updateUserRole(uid: string, newRole: string): Promise<void> {
    try {
      await updateDoc(doc(this.firestore, 'users', uid), {
        role: newRole,
        roleUpdatedAt: new Date()
      });
      console.log('User role updated:', uid, newRole);
    } catch (error) {
      console.error('Error updating user role:', error);
      throw error;
    }
  }




  async logout(): Promise<void> {
    return signOut(this.auth);
  }


  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }


  isLoggedIn(): boolean {
    return this.currentUserSubject.value !== null;
  }

  async getUserProfiles(uids: string[]): Promise<any[]> {
    if (!uids.length) return [];
    try {
      const docs = await Promise.all(uids.map(uid => getDoc(doc(this.firestore, 'users', uid))));
      return docs.filter(d => d.exists()).map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
      console.error('Error fetching user profiles:', error);
      return [];
    }
  }


  async getUserProfile(uid: string): Promise<any> {
    try {
      const userDoc = await getDoc(doc(this.firestore, 'users', uid));
      if (userDoc.exists()) {
        return userDoc.data();
      }
      return null;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
  }


  async updateUserProfile(uid: string, data: any): Promise<void> {
    try {
      await updateDoc(doc(this.firestore, 'users', uid), data);
      console.log('User profile updated successfully');
    } catch (error) {
      console.error('Error updating user profile:', error);
      throw error;
    }
  }




  private handleAuthError(error: AuthError): Error {
    console.error('Auth error:', error.code);
    
    switch (error.code) {
      case 'auth/user-not-found':
        return new Error('Account not registered. Please sign up first.');
      case 'auth/wrong-password':
        return new Error('Invalid password. Please try again.');
      case 'auth/invalid-email':
        return new Error('Invalid email format.');
      case 'auth/user-disabled':
        return new Error('This account has been disabled.');
      case 'auth/too-many-requests':
        return new Error('Too many login attempts. Please try again later.');
      case 'auth/email-already-in-use':
        return new Error('Email already registered. Please login or use a different email.');
      default:
        return new Error(error.message || 'Authentication failed');
    }
  }



  async uploadFile(path: string, data: File | Blob): Promise<string> {
    const storageRef = ref(this.storage, path);
    await uploadBytes(storageRef, data);
    return getDownloadURL(storageRef);
  }




  async getPendingAlumniVerification() {
    try {
      const usersRef = collection(this.firestore, 'users');
      const q = query(
        usersRef,
        where('userType', '==', 'alumni'),
        where('alumniIdVerificationStatus', '==', 'pending')
      );
      const querySnapshot = await getDocs(q);
      
      const alumni: any[] = [];
      querySnapshot.forEach((doc) => {
        alumni.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      return alumni;
    } catch (error) {
      console.error('Error getting pending alumni verification:', error);
      throw error;
    }
  }


  async getVerifiedAlumni(): Promise<any[]> {
    try {
      const q = query(
        collection(this.firestore, 'users'),
        where('userType', '==', 'alumni'),
        where('alumniIdVerificationStatus', '==', 'approved')
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
      console.error('Error getting verified alumni:', error);
      return [];
    }
  }


  async requestAlumniIdVerification(
    userId: string,
    gradPhotoFile: File,
    termGraduated: string,
    socialMediaLink: string,
    signatureFile?: File
  ): Promise<void> {
    const alumniGradPhotoUrl = await this.uploadFile(`alumni-ids/${userId}/grad-photo`, gradPhotoFile);

    let userSignatureUrl = '';
    if (signatureFile) {
      userSignatureUrl = await this.uploadFile(`alumni-ids/${userId}/user-signature`, signatureFile);
    }

    await updateDoc(doc(this.firestore, 'users', userId), {
      alumniGradPhotoUrl,
      alumniIdVerificationStatus: 'pending',
      alumniIdSubmittedAt: new Date().toISOString(),
      alumniIdRejectionReason: '',
      alumniTermGraduated: termGraduated,
      alumniSocialMedia: socialMediaLink,
      userSignatureUrl,
    });
  }


  private generateAlumniReferenceNumber(): string {
    const year = new Date().getFullYear();
    const rand = Math.floor(10000 + Math.random() * 90000);
    return `USJ-ALM-${year}-${rand}`;
  }

  async verifyAlumniId(
    userId: string,
    status: 'approved' | 'rejected',
    rejectionReason: string = '',
    signatureFile?: File,
    approverName?: string
  ) {
    try {
      const userRef = doc(this.firestore, 'users', userId);
      const updateData: any = {
        alumniIdVerificationStatus: status,
        alumniIdVerificationDate: new Date().toISOString()
      };

      if (status === 'approved') {
        if (signatureFile) {
          updateData.adminSignatureUrl = await this.uploadFile(`alumni-ids/${userId}/admin-signature`, signatureFile);
        }
        updateData.alumniIdReferenceNumber = this.generateAlumniReferenceNumber();
        updateData.approvedByName = approverName || 'Admin';
      }

      if (status === 'rejected' && rejectionReason) {
        updateData.alumniIdRejectionReason = rejectionReason;
      }

      await updateDoc(userRef, updateData);
      if (status === 'approved') {
        await this.createNotification(
          userId,
          'Alumni ID Verified ✓',
          'Your alumni ID has been verified by the admin. Your account is now fully verified.',
          'success',
          '/profile'
        );
      } else if (status === 'rejected') {
        const reason = rejectionReason ? ` Reason: ${rejectionReason}` : '';
        await this.createNotification(
          userId,
          'Alumni ID Verification Failed',
          `Your alumni ID could not be verified.${reason} Please re-submit a valid ID from your profile.`,
          'error',
          '/profile'
        );
      }
      console.log(`Alumni ID ${status}:`, userId);
    } catch (error) {
      console.error('Error verifying alumni ID:', error);
      throw error;
    }
  }




  async approveUser(userId: string): Promise<void> {
    try {
      const userRef = doc(this.firestore, 'users', userId);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.data() || {};

      await updateDoc(userRef, {
        status: 'approved',
        approvalDate: new Date().toISOString(),
        approvalStatus: 'approved'
      });

      await this.createNotification(userId, 'Account Approved', 'Your account has been approved. You can now access all features of JosenianLink.', 'success');

      if (userData['email']) {
        await sendPasswordResetEmail(this.auth, userData['email']).catch(err =>
          console.error('Failed to send approval email:', err)
        );
      }

      console.log('User approved:', userId);
    } catch (error) {
      console.error('Error approving user:', error);
      throw error;
    }
  }


  async rejectUser(userId: string, rejectionReason: string = ''): Promise<void> {
    try {
      const userRef = doc(this.firestore, 'users', userId);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.data() || {};

      await updateDoc(userRef, {
        status: 'rejected',
        rejectionDate: new Date().toISOString(),
        rejectionReason: rejectionReason
      });

      await this.createNotification(userId, 'Account Registration Rejected', 'Your account registration was not approved. Please ensure your information is correct or contact the administrator.', 'error');

      if (userData['email']) {
        await sendPasswordResetEmail(this.auth, userData['email']).catch(err =>
          console.error('Failed to send rejection email:', err)
        );
      }

      console.log('User rejected:', userId);
    } catch (error) {
      console.error('Error rejecting user:', error);
      throw error;
    }
  }


  async createNotification(
    userId: string,
    title: string,
    message: string,
    type: 'success' | 'error' | 'info' | 'warning' | 'event' | 'connection' | 'points' | 'system',
    redirectLink?: string
  ): Promise<void> {
    try {
      const notificationsRef = collection(this.firestore, 'users', userId, 'notifications');
      const data: any = { title, message, type, createdAt: new Date().toISOString(), read: false };
      if (redirectLink) data['redirectLink'] = redirectLink;
      await addDoc(notificationsRef, data);
    } catch (error) {
      console.error('Error creating notification:', error);
    }
  }

  private async notifyAllApprovedUsers(title: string, message: string, type: string, redirectLink?: string): Promise<void> {
    try {
      const snap = await getDocs(query(
        collection(this.firestore, 'users'),
        where('status', '==', 'approved'),
        where('role', '==', 'user')
      ));
      await Promise.all(snap.docs.map(d =>
        this.createNotification(d.id, title, message, type as any, redirectLink)
      ));
    } catch (err) {
      console.error('Error notifying all users:', err);
    }
  }

  async sendAnnouncement(title: string, message: string): Promise<void> {
    await this.notifyAllApprovedUsers(title, message, 'system', '/home');
  }


  async getNotifications(userId: string): Promise<any[]> {
    try {
      const notificationsRef = collection(this.firestore, 'users', userId, 'notifications');
      const q = query(notificationsRef);
      const querySnapshot = await getDocs(q);
      
      const notifications: any[] = [];
      querySnapshot.forEach((doc) => {
        notifications.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      return notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (error) {
      console.error('Error getting notifications:', error);
      return [];
    }
  }


  async markNotificationAsRead(userId: string, notificationId: string): Promise<void> {
    try {
      const notifRef = doc(this.firestore, 'users', userId, 'notifications', notificationId);
      await updateDoc(notifRef, { read: true });
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  }


  async markAllNotificationsAsRead(userId: string): Promise<void> {
    try {
      const notificationsRef = collection(this.firestore, 'users', userId, 'notifications');
      const q = query(notificationsRef, where('read', '==', false));
      const snapshot = await getDocs(q);
      await Promise.all(snapshot.docs.map(d => updateDoc(d.ref, { read: true })));
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  }


  async deleteNotification(userId: string, notificationId: string): Promise<void> {
    try {
      await deleteDoc(doc(this.firestore, 'users', userId, 'notifications', notificationId));
    } catch (error) {
      console.error('Error deleting notification:', error);
      throw error;
    }
  }




  async getEvents(): Promise<any[]> {
    try {
      const snapshot = await getDocs(collection(this.firestore, 'events'));
      return snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    } catch (error) {
      console.error('Error fetching events:', error);
      return [];
    }
  }

  async getGlobalEvents(): Promise<any[]> {
    try {
      const snapshot = await getDocs(collection(this.firestore, 'events'));
      return snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => {
          const dA = new Date(`${a.date}T${a.time || '00:00'}`).getTime();
          const dB = new Date(`${b.date}T${b.time || '00:00'}`).getTime();
          return dA - dB;
        });
    } catch (error) {
      console.error('Error fetching global events:', error);
      return [];
    }
  }

  async addGlobalEvent(eventData: {
    title: string; description: string; date: string; time: string;
    location: string; eventType: string; maxParticipants?: number | null;
    coverImageFile?: File; coverImageUrl?: string; coverImageFileName?: string;
    eventCategory?: string; inspireCategory?: string; pointValue?: number;
  }): Promise<any> {
    try {
      const user = this.auth.currentUser;
      const docRef = doc(collection(this.firestore, 'events'));

      let coverImageUrl = eventData.coverImageUrl || '';
      if (eventData.coverImageFile) {
        coverImageUrl = await this.uploadFile(`event-covers/${docRef.id}`, eventData.coverImageFile);
      }

      await setDoc(docRef, {
        title: eventData.title,
        description: eventData.description,
        date: eventData.date,
        time: eventData.time,
        location: eventData.location,
        eventType: eventData.eventType,
        maxParticipants: eventData.maxParticipants || null,
        coverImageUrl,
        coverImageFileName: eventData.coverImageFileName || '',
        eventCategory: eventData.eventCategory || 'regular',
        inspireCategory: eventData.inspireCategory || 'service',
        pointValue: eventData.pointValue ?? 10,
        attendees: [],
        createdBy: user?.uid || 'admin',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      this.notifyAllApprovedUsers(
        `New Event: ${eventData.title}`,
        `A new event "${eventData.title}" is happening on ${eventData.date} at ${eventData.location}. Check it out!`,
        'event',
        '/feeds'
      );
      return { id: docRef.id, ...eventData, coverImageUrl, attendees: [] };
    } catch (error) {
      console.error('Error adding global event:', error);
      throw error;
    }
  }

  async updateGlobalEvent(eventId: string, eventData: any): Promise<void> {
    try {
      const payload = { ...eventData };
      if (payload.coverImageFile) {
        payload.coverImageUrl = await this.uploadFile(`event-covers/${eventId}`, payload.coverImageFile);
        delete payload.coverImageFile;
      }
      await updateDoc(doc(this.firestore, 'events', eventId), {
        ...payload,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Error updating global event:', error);
      throw error;
    }
  }

  async deleteGlobalEvent(eventId: string): Promise<void> {
    try {
      await deleteDoc(doc(this.firestore, 'events', eventId));
    } catch (error) {
      console.error('Error deleting global event:', error);
      throw error;
    }
  }

  async joinGlobalEvent(eventId: string, userId: string): Promise<void> {
    try {
      const ref = doc(this.firestore, 'events', eventId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const attendees: string[] = snap.data()['attendees'] || [];
        if (!attendees.includes(userId)) {
          await updateDoc(ref, { attendees: [...attendees, userId] });
        }
      }
    } catch (error) {
      console.error('Error joining event:', error);
      throw error;
    }
  }

  async leaveGlobalEvent(eventId: string, userId: string): Promise<void> {
    try {
      const ref = doc(this.firestore, 'events', eventId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const attendees = (snap.data()['attendees'] || []).filter((id: string) => id !== userId);
        await updateDoc(ref, { attendees });
      }
    } catch (error) {
      console.error('Error leaving event:', error);
      throw error;
    }
  }

  async getUserPostCount(uid: string): Promise<number> {
    try {
      const snapshot = await getDocs(collection(this.firestore, `users/${uid}/posts`));
      return snapshot.size;
    } catch (error) {
      console.error('Error fetching post count:', error);
      return 0;
    }
  }


  async addEvent(eventData: { title: string; date: string; type: string; description?: string; attendees?: number }): Promise<any> {
    try {
      const docRef = await addDoc(collection(this.firestore, 'events'), {
        ...eventData,
        attendees: eventData.attendees || 0,
        createdAt: new Date()
      });
      return { id: docRef.id, ...eventData };
    } catch (error) {
      console.error('Error adding event:', error);
      throw error;
    }
  }



  async getDepartmentEvents(departmentId: string): Promise<any[]> {
    try {
      const snap = await getDocs(collection(this.firestore, `departments/${departmentId}/events`));
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
    } catch (error) {
      console.error('Error fetching department events:', error);
      return [];
    }
  }

  async addDepartmentEvent(departmentId: string, eventData: any): Promise<any> {
    try {
      const docRef = await addDoc(collection(this.firestore, `departments/${departmentId}/events`), {
        ...eventData,
        attendees: [],
        createdAt: new Date()
      });
      return { id: docRef.id, ...eventData, attendees: [] };
    } catch (error) {
      console.error('Error adding department event:', error);
      throw error;
    }
  }

  async updateDepartmentEvent(departmentId: string, eventId: string, data: any): Promise<void> {
    try {
      await updateDoc(doc(this.firestore, `departments/${departmentId}/events`, eventId), {
        ...data,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Error updating department event:', error);
      throw error;
    }
  }

  async deleteDepartmentEvent(departmentId: string, eventId: string): Promise<void> {
    try {
      await deleteDoc(doc(this.firestore, `departments/${departmentId}/events`, eventId));
    } catch (error) {
      console.error('Error deleting department event:', error);
      throw error;
    }
  }

  async joinDepartmentEvent(departmentId: string, eventId: string, userId: string): Promise<void> {
    try {
      const eventRef = doc(this.firestore, `departments/${departmentId}/events`, eventId);
      const eventDoc = await getDoc(eventRef);
      if (eventDoc.exists()) {
        const attendees: string[] = eventDoc.data()['attendees'] || [];
        if (!attendees.includes(userId)) {
          attendees.push(userId);
          await updateDoc(eventRef, { attendees });
        }
      }
    } catch (error) {
      console.error('Error joining department event:', error);
      throw error;
    }
  }

  async leaveDepartmentEvent(departmentId: string, eventId: string, userId: string): Promise<void> {
    try {
      const eventRef = doc(this.firestore, `departments/${departmentId}/events`, eventId);
      const eventDoc = await getDoc(eventRef);
      if (eventDoc.exists()) {
        const attendees: string[] = (eventDoc.data()['attendees'] || []).filter((id: string) => id !== userId);
        await updateDoc(eventRef, { attendees });
      }
    } catch (error) {
      console.error('Error leaving department event:', error);
      throw error;
    }
  }



  async getDepartmentWallPosts(departmentId: string): Promise<any[]> {
    try {
      const snap = await getDocs(collection(this.firestore, `departments/${departmentId}/wall`));
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => {
          const aTime = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
          const bTime = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
          return bTime - aTime;
        });
    } catch (error) {
      console.error('Error fetching wall posts:', error);
      return [];
    }
  }

  async addDepartmentWallPost(departmentId: string, postData: any): Promise<any> {
    try {
      const docRef = await addDoc(collection(this.firestore, `departments/${departmentId}/wall`), {
        ...postData,
        likes: [],
        createdAt: new Date()
      });
      return { id: docRef.id, ...postData, likes: [] };
    } catch (error) {
      console.error('Error adding wall post:', error);
      throw error;
    }
  }

  async deleteDepartmentWallPost(departmentId: string, postId: string): Promise<void> {
    try {
      await deleteDoc(doc(this.firestore, `departments/${departmentId}/wall`, postId));
    } catch (error) {
      console.error('Error deleting wall post:', error);
      throw error;
    }
  }

  async toggleDepartmentWallLike(departmentId: string, postId: string, userId: string): Promise<void> {
    try {
      const postRef = doc(this.firestore, `departments/${departmentId}/wall`, postId);
      const postDoc = await getDoc(postRef);
      if (postDoc.exists()) {
        let likes: string[] = postDoc.data()['likes'] || [];
        likes = likes.includes(userId) ? likes.filter(id => id !== userId) : [...likes, userId];
        await updateDoc(postRef, { likes });
      }
    } catch (error) {
      console.error('Error toggling wall like:', error);
      throw error;
    }
  }



  async generateEventQRToken(eventId: string): Promise<string> {
    const token = this.generateSecureToken();
    await updateDoc(doc(this.firestore, 'events', eventId), {
      qrToken: token,
      qrGeneratedAt: new Date()
    });
    return token;
  }

  async verifyAndRecordAttendance(
    eventId: string,
    scannedToken: string,
    userId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const eventSnap = await getDoc(doc(this.firestore, 'events', eventId));
      if (!eventSnap.exists()) return { success: false, message: 'Event not found.' };
      const event = eventSnap.data();

      if (!event['qrToken'] || event['qrToken'] !== scannedToken) {
        return { success: false, message: 'Invalid QR code. Please scan the correct code at the venue.' };
      }

      if (event['date']) {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (event['date'] !== today) {
          return { success: false, message: `This QR is for ${event['date']}. Attendance can only be recorded on the event day.` };
        }
      }

      if (event['time']) {
        const [h, m] = (event['time'] as string).split(':').map(Number);
        const start = new Date();
        start.setHours(h, m, 0, 0);
        const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
        const now = new Date();
        if (now < start) {
          return { success: false, message: `This event hasn't started yet. Check-in opens at ${event['time']}.` };
        }
        if (now >= end) {
          await updateDoc(doc(this.firestore, 'events', eventId), { qrToken: null });
          return { success: false, message: 'This event has ended and the QR code has expired.' };
        }
      }

      const attendees: string[] = event['attendees'] || [];
      if (!attendees.includes(userId)) {
        return { success: false, message: 'You must join this event before scanning the QR code.' };
      }

      const attendanceRef = doc(this.firestore, 'events', eventId, 'attendance', userId);
      const existing = await getDoc(attendanceRef);
      if (existing.exists()) {
        return { success: false, message: 'Your attendance has already been recorded for this event.' };
      }

      const profile = await this.getUserProfile(userId);
      await setDoc(attendanceRef, {
        userId,
        userName: `${profile?.['firstName'] || ''} ${profile?.['lastName'] || ''}`.trim() || 'Unknown',
        userEmail: profile?.['email'] || '',
        userType: profile?.['userType'] || 'user',
        scannedAt: new Date(),
        status: 'attended'
      });

      await updateDoc(doc(this.firestore, 'events', eventId), {
        attendanceCount: increment(1)
      });


      const pointValue = event['pointValue'] ?? this.getDefaultPoints(event['eventCategory'] || 'regular');
      await this.awardEventPoints(userId, eventId, event['title'] || 'Event', pointValue, event['eventCategory'] || 'regular');
      const inspireCategory = event['inspireCategory'] || 'service';
      await this.awardInspiredPoints(userId, inspireCategory, pointValue, `Attended: ${event['title'] || 'Event'}`, `${inspireCategory}_ev_${eventId}`);
      await this.createNotification(
        userId,
        'Attendance Recorded',
        `Your attendance for "${event['title'] || 'the event'}" has been recorded. You earned +${pointValue} points!`,
        'success',
        '/history'
      );

      return { success: true, message: `Attendance recorded! +${pointValue} points earned.` };
    } catch (error) {
      console.error('QR verification error:', error);
      return { success: false, message: 'An error occurred. Please try again.' };
    }
  }

  async getEventAttendance(eventId: string): Promise<any[]> {
    try {
      const snap = await getDocs(collection(this.firestore, 'events', eventId, 'attendance'));
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => {
          const aTime = a.scannedAt?.toMillis ? a.scannedAt.toMillis() : new Date(a.scannedAt || 0).getTime();
          const bTime = b.scannedAt?.toMillis ? b.scannedAt.toMillis() : new Date(b.scannedAt || 0).getTime();
          return bTime - aTime;
        });
    } catch (error) {
      console.error('Error fetching attendance:', error);
      return [];
    }
  }

  async generateDepartmentEventQRToken(departmentId: string, eventId: string): Promise<string> {
    const token = this.generateSecureToken();
    await updateDoc(doc(this.firestore, `departments/${departmentId}/events`, eventId), {
      qrToken: token,
      qrGeneratedAt: new Date()
    });
    return token;
  }

  async verifyAndRecordDeptAttendance(
    departmentId: string,
    eventId: string,
    scannedToken: string,
    userId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const eventSnap = await getDoc(doc(this.firestore, `departments/${departmentId}/events`, eventId));
      if (!eventSnap.exists()) return { success: false, message: 'Event not found.' };
      const event = eventSnap.data();

      if (!event['qrToken'] || event['qrToken'] !== scannedToken) {
        return { success: false, message: 'Invalid QR code. Please scan the correct code at the venue.' };
      }

      if (event['date']) {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (event['date'] !== today) {
          return { success: false, message: `This QR is for ${event['date']}. Attendance can only be recorded on the event day.` };
        }
      }

      const attendees: string[] = event['attendees'] || [];
      if (!attendees.includes(userId)) {
        return { success: false, message: 'You must join this event before scanning the QR code.' };
      }

      const attendanceRef = doc(this.firestore, `departments/${departmentId}/events/${eventId}/attendance`, userId);
      const existing = await getDoc(attendanceRef);
      if (existing.exists()) {
        return { success: false, message: 'Your attendance has already been recorded for this event.' };
      }

      const profile = await this.getUserProfile(userId);
      await setDoc(attendanceRef, {
        userId,
        userName: `${profile?.['firstName'] || ''} ${profile?.['lastName'] || ''}`.trim() || 'Unknown',
        userEmail: profile?.['email'] || '',
        userType: profile?.['userType'] || 'user',
        scannedAt: new Date(),
        status: 'attended'
      });

      await updateDoc(doc(this.firestore, `departments/${departmentId}/events`, eventId), {
        attendanceCount: increment(1)
      });

      const pointValue = event['pointValue'] ?? 10;
      await this.awardEventPoints(userId, `dept_${eventId}`, event['title'] || 'Dept Event', pointValue, 'regular');
      const inspireCategory = event['inspireCategory'] || 'service';
      await this.awardInspiredPoints(userId, inspireCategory, pointValue, `Attended: ${event['title'] || 'Dept Event'}`, `${inspireCategory}_dept_${eventId}`);
      await this.createNotification(
        userId,
        'Attendance Recorded',
        `Your attendance for "${event['title'] || 'the event'}" has been recorded. You earned +${pointValue} points!`,
        'success',
        '/history'
      );

      return { success: true, message: `Attendance recorded! +${pointValue} points earned.` };
    } catch (error) {
      console.error('Dept QR verification error:', error);
      return { success: false, message: 'An error occurred. Please try again.' };
    }
  }

  async getDeptEventAttendance(departmentId: string, eventId: string): Promise<any[]> {
    try {
      const snap = await getDocs(collection(this.firestore, `departments/${departmentId}/events/${eventId}/attendance`));
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => {
          const aTime = a.scannedAt?.toMillis ? a.scannedAt.toMillis() : new Date(a.scannedAt || 0).getTime();
          const bTime = b.scannedAt?.toMillis ? b.scannedAt.toMillis() : new Date(b.scannedAt || 0).getTime();
          return bTime - aTime;
        });
    } catch (error) {
      console.error('Error fetching dept attendance:', error);
      return [];
    }
  }

  async getUserDeptEventStats(userId: string, departmentId: string): Promise<{
    totalEvents: number; eventsJoined: number; eventsAttended: number; attendanceRate: number;
  }> {
    try {
      const eventsSnap = await getDocs(collection(this.firestore, `departments/${departmentId}/events`));
      const events = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      const joined = events.filter(e => (e.attendees || []).includes(userId));
      let attended = 0;
      for (const e of joined) {
        const attSnap = await getDoc(doc(this.firestore, `departments/${departmentId}/events/${e.id}/attendance`, userId));
        if (attSnap.exists()) attended++;
      }
      return {
        totalEvents: events.length,
        eventsJoined: joined.length,
        eventsAttended: attended,
        attendanceRate: joined.length > 0 ? Math.round((attended / joined.length) * 100) : 0
      };
    } catch {
      return { totalEvents: 0, eventsJoined: 0, eventsAttended: 0, attendanceRate: 0 };
    }
  }

  async getDeptOverallStats(departmentId: string): Promise<{
    totalEvents: number; totalAttendances: number; totalRegistrations: number;
    avgAttendanceRate: number; eventsByType: { type: string; count: number }[];
  }> {
    try {
      const eventsSnap = await getDocs(collection(this.firestore, `departments/${departmentId}/events`));
      const events = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
      const totalEvents = events.length;
      const totalAttendances = events.reduce((s, e) => s + (e.attendanceCount || 0), 0);
      const totalRegistrations = events.reduce((s, e) => s + (e.attendees?.length || 0), 0);
      const avgAttendanceRate = totalRegistrations > 0
        ? Math.round((totalAttendances / totalRegistrations) * 100) : 0;
      const typeMap: Record<string, number> = {};
      events.forEach(e => { const t = e.type || 'other'; typeMap[t] = (typeMap[t] || 0) + 1; });
      const eventsByType = Object.entries(typeMap)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);
      return { totalEvents, totalAttendances, totalRegistrations, avgAttendanceRate, eventsByType };
    } catch {
      return { totalEvents: 0, totalAttendances: 0, totalRegistrations: 0, avgAttendanceRate: 0, eventsByType: [] };
    }
  }



  private readonly POINTS_MAP: { [key: string]: number } = {
    regular: 10, special: 20, volunteer: 30,
  };

  getDefaultPoints(category: string): number {
    return this.POINTS_MAP[category] || 10;
  }

  getUserLevel(points: number): { level: string; label: string; next: number; color: string; icon: string } {
    if (points >= 300) return { level: 'platinum', label: 'Platinum', next: -1,  color: '#8b5cf6', icon: 'diamond'      };
    if (points >= 150) return { level: 'gold',     label: 'Gold',     next: 300, color: '#f59e0b', icon: 'trophy'       };
    if (points >= 50)  return { level: 'silver',   label: 'Silver',   next: 150, color: '#6b7280', icon: 'medal'        };
    return               { level: 'bronze',   label: 'Bronze',   next: 50,  color: '#b45309', icon: 'ribbon'       };
  }

  computeBadges(totalPoints: number, eventCount: number): string[] {
    const badges: string[] = [];
    if (eventCount >= 1)    badges.push('first_event');
    if (eventCount >= 5)    badges.push('active_alumni');
    if (totalPoints >= 50)  badges.push('event_supporter');
    if (totalPoints >= 100) badges.push('community_champion');
    if (totalPoints >= 300) badges.push('top_contributor');
    return badges;
  }

  async awardEventPoints(userId: string, eventId: string, eventTitle: string, points: number, category: string): Promise<void> {
    try {
      const historyRef = doc(this.firestore, 'users', userId, 'pointsHistory', eventId);
      if ((await getDoc(historyRef)).exists()) return;

      await setDoc(historyRef, {
        eventId, eventTitle, points, category,
        type: 'event_attendance',
        awardedAt: new Date(),
      });
      await updateDoc(doc(this.firestore, 'users', userId), { totalPoints: increment(points) });


      const profile = await this.getUserProfile(userId);
      const newTotal = (profile?.['totalPoints'] || 0) + points;
      const histSnap = await getDocs(collection(this.firestore, 'users', userId, 'pointsHistory'));
      const eventAttendanceCount = histSnap.docs.filter(d => d.data()['type'] === 'event_attendance').length;
      await updateDoc(doc(this.firestore, 'users', userId), {
        badges: this.computeBadges(newTotal, eventAttendanceCount),
      });
    } catch (err) {
      console.error('Error awarding points:', err);
    }
  }

  async getUserPointsHistory(userId: string): Promise<any[]> {
    try {
      const snap = await getDocs(collection(this.firestore, 'users', userId, 'pointsHistory'));
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => {
          const aT = a.awardedAt?.toMillis?.() ?? new Date(a.awardedAt || 0).getTime();
          const bT = b.awardedAt?.toMillis?.() ?? new Date(b.awardedAt || 0).getTime();
          return bT - aT;
        });
    } catch (err) {
      console.error('Error fetching points history:', err);
      return [];
    }
  }

  async adminAdjustPoints(userId: string, amount: number, reason: string): Promise<void> {
    const ref = doc(collection(this.firestore, 'users', userId, 'pointsHistory'));
    await setDoc(ref, {
      eventId: '', eventTitle: reason, points: amount,
      category: 'admin_adjustment', type: 'admin_adjustment',
      reason, awardedAt: new Date(),
    });
    await updateDoc(doc(this.firestore, 'users', userId), { totalPoints: increment(amount) });
    const sign = amount >= 0 ? `+${amount}` : `${amount}`;
    await this.createNotification(
      userId,
      'Points Updated',
      `Your points have been adjusted by ${sign}. Reason: ${reason}`,
      'points',
      '/history'
    );
  }

  async createNomination(data: {
    nomineeId: string;
    nomineeName: string;
    nomineeEmail: string;
    nominatedBy: string;
    nominatedByName: string;
    inspireCategory: string;
    points: number;
    reason: string;
    proofFile?: File;
  }): Promise<void> {
    const nominationRef = doc(collection(this.firestore, 'nominations'));
    let proofFileUrl = '';
    let proofFileName = '';
    if (data.proofFile) {
      proofFileUrl = await this.uploadFile(`nominations/${nominationRef.id}/proof`, data.proofFile);
      proofFileName = data.proofFile.name;
    }
    const { proofFile: _proofFile, ...rest } = data;
    await setDoc(nominationRef, { ...rest, proofFileUrl, proofFileName, createdAt: new Date() });
    await this.awardInspiredPoints(
      data.nomineeId,
      data.inspireCategory as 'interiority' | 'nationalism' | 'service' | 'pioneerism' | 'integrity' | 'reliability' | 'excellence',
      data.points,
      `Nominated: ${data.reason}`,
      `nomination_${nominationRef.id}`
    );
    // Also increment totalPoints so nominations count toward the leaderboard
    const histRef = doc(collection(this.firestore, 'users', data.nomineeId, 'pointsHistory'));
    await setDoc(histRef, {
      eventId: nominationRef.id,
      eventTitle: `INSPIRE Nomination (${data.inspireCategory}): ${data.reason}`,
      points: data.points,
      category: 'nomination',
      type: 'nomination',
      awardedAt: new Date(),
    });
    await updateDoc(doc(this.firestore, 'users', data.nomineeId), { totalPoints: increment(data.points) });
    await this.createNotification(
      data.nomineeId,
      'INSPIRE Nomination Received',
      `You have been nominated by ${data.nominatedByName} and awarded ${data.points} INSPIRE points for ${data.inspireCategory}.`,
      'points',
      '/profile'
    );
  }

  async getNominations(): Promise<any[]> {
    try {
      const snap = await getDocs(query(
        collection(this.firestore, 'nominations'),
        orderBy('createdAt', 'desc'),
        limit(50)
      ));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      console.error('Error fetching nominations:', err);
      return [];
    }
  }

  async getLeaderboard(limitCount: number = 10): Promise<any[]> {
    try {
      const snap = await getDocs(query(
        collection(this.firestore, 'users'),
        orderBy('totalPoints', 'desc'),
        limit(limitCount)
      ));
      return snap.docs
        .map((d, i) => {
          const u: any = { id: d.id, ...d.data() };
          return {
            rank: i + 1,
            id: u.id,
            name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unknown',
            initials: ((u.firstName?.charAt(0) || '') + (u.lastName?.charAt(0) || '')).toUpperCase() || 'U',
            totalPoints: u.totalPoints || 0,
            level: this.getUserLevel(u.totalPoints || 0),
            userType: u.userType || '',
            photoUrl: u.photoUrl || '',
          };
        })
        .filter((u: any) => u.totalPoints > 0);
    } catch (err) {
      console.error('Error fetching leaderboard:', err);
      return [];
    }
  }

  private generateSecureToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }



  private readonly INSPIRED_NAMES: Readonly<Record<string, string>> = {
    interiority: 'Interiority',
    nationalism:  'Nationalism',
    service:      'Service',
    pioneerism:   'Pioneerism',
    integrity:    'Integrity',
    reliability:  'Reliability',
    excellence:   'Excellence',
  };

  getInspiredBadgeLevel(points: number): string {
    if (points >= 25) return 'Gold';
    if (points >= 10) return 'Silver';
    if (points >= 1)  return 'Bronze';
    return 'None';
  }

  async awardInspiredPoints(
    userId: string,
    category: 'interiority' | 'nationalism' | 'service' | 'pioneerism' | 'integrity' | 'reliability' | 'excellence',
    points: number,
    reason: string,
    uniqueKey?: string
  ): Promise<void> {
    try {
      if (uniqueKey) {
        const gateRef = doc(this.firestore, 'users', userId, 'pointsHistory', `inspired_${uniqueKey}`);
        if ((await getDoc(gateRef)).exists()) return;
        await setDoc(gateRef, { type: 'inspired_gate', category, points, reason, awardedAt: new Date() });
      }
      const userRef = doc(this.firestore, 'users', userId);
      const snap = await getDoc(userRef);
      const inspired: Record<string, number> = (snap.data() as any)?.inspiredPoints || {};
      const oldVal = Number(inspired[category] || 0);
      const newVal = oldVal + points;
      await updateDoc(userRef, { [`inspiredPoints.${category}`]: increment(points) });
      const oldLevel = this.getInspiredBadgeLevel(oldVal);
      const newLevel = this.getInspiredBadgeLevel(newVal);
      if (newLevel !== oldLevel && newLevel !== 'None') {
        await this.createNotification(
          userId, 'INSPIRED Badge Unlocked!',
          `You reached ${newLevel} level in ${this.INSPIRED_NAMES[category]}! Keep embodying USJ-R core values.`,
          'points', '/profile'
        );
      }
      const updatedInspired: Record<string, number> = { ...inspired, [category]: newVal };
      const hadMaster = Object.keys(this.INSPIRED_NAMES).every(c => Number(inspired[c] || 0) >= 10);
      const hasMaster  = Object.keys(this.INSPIRED_NAMES).every(c => Number(updatedInspired[c] || 0) >= 10);
      if (hasMaster && !hadMaster) {
        await updateDoc(userRef, { inspiredMasterBadge: true });
        await this.createNotification(
          userId, 'Master INSPIRED Badge Earned!',
          'You have embodied all 7 USJ-R core values and earned the master INSPIRED badge!',
          'points', '/profile'
        );
      }
    } catch (err) {
      console.error('Error awarding INSPIRED points:', err);
    }
  }

  async awardInspiredProfileComplete(_userId: string, _profileData: { bio: string; gender: string; address: string; contactNumber: string }): Promise<void> {
    // INSPIRE points are only earned through event attendance and admin nominations
  }



  async sendFriendRequest(toUserId: string): Promise<void> {
    const currentUser = this.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');
    const fromId = currentUser.uid;
    const myProfile = await this.getUserProfile(fromId);
    const fromName = `${myProfile?.['firstName'] || ''} ${myProfile?.['lastName'] || ''}`.trim();
    const fromInitials = fromName.split(' ').filter(Boolean).map((w: string) => w[0].toUpperCase()).join('').slice(0, 2) || '?';
    await setDoc(doc(this.firestore, 'users', toUserId, 'friendRequests', fromId), {
      fromId, fromName, fromInitials, sentAt: new Date().toISOString()
    });
    await updateDoc(doc(this.firestore, 'users', fromId), { sentRequests: arrayUnion(toUserId) });
    await this.createNotification(
      toUserId,
      'New Friend Request',
      `${fromName || 'Someone'} sent you a friend request.`,
      'connection',
      '/network'
    );
  }

  async cancelFriendRequest(toUserId: string): Promise<void> {
    const currentUser = this.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');
    const fromId = currentUser.uid;
    await deleteDoc(doc(this.firestore, 'users', toUserId, 'friendRequests', fromId));
    await updateDoc(doc(this.firestore, 'users', fromId), { sentRequests: arrayRemove(toUserId) });
  }

  async getFriendRequests(userId: string): Promise<any[]> {
    const snapshot = await getDocs(collection(this.firestore, 'users', userId, 'friendRequests'));
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async acceptFriendRequest(fromUserId: string): Promise<void> {
    const currentUser = this.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');
    const myId = currentUser.uid;
    const batch = writeBatch(this.firestore);
    batch.update(doc(this.firestore, 'users', myId), { friends: arrayUnion(fromUserId) });
    batch.update(doc(this.firestore, 'users', fromUserId), { friends: arrayUnion(myId), sentRequests: arrayRemove(myId) });
    batch.delete(doc(this.firestore, 'users', myId, 'friendRequests', fromUserId));
    await batch.commit();
    const myProfile = await this.getUserProfile(myId);
    const myName = `${myProfile?.['firstName'] || ''} ${myProfile?.['lastName'] || ''}`.trim() || 'Someone';
    await this.createNotification(
      fromUserId,
      'Friend Request Accepted',
      `${myName} accepted your friend request.`,
      'connection',
      '/network'
    );
  }

  async declineFriendRequest(fromUserId: string): Promise<void> {
    const currentUser = this.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');
    const myId = currentUser.uid;
    await deleteDoc(doc(this.firestore, 'users', myId, 'friendRequests', fromUserId));
    await updateDoc(doc(this.firestore, 'users', fromUserId), { sentRequests: arrayRemove(myId) });
  }

  async removeFriend(targetUserId: string): Promise<void> {
    const currentUser = this.getCurrentUser();
    if (!currentUser) throw new Error('Not authenticated');
    const myId = currentUser.uid;
    const batch = writeBatch(this.firestore);
    batch.update(doc(this.firestore, 'users', myId), { friends: arrayRemove(targetUserId) });
    batch.update(doc(this.firestore, 'users', targetUserId), { friends: arrayRemove(myId) });
    await batch.commit();
  }


  async autoApproveIfEligible(userId: string): Promise<boolean> {
    try {
      const userRef = doc(this.firestore, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) return false;
      
      const userData = userDoc.data();
      const email = userData?.['email'] || '';
      

      if (email.endsWith('@usj.edu.ph')) {
        await this.approveUser(userId);
        console.log('Auto-approved user with @usj.edu.ph email:', userId);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error in auto-approval check:', error);
      return false;
    }
  }
}
