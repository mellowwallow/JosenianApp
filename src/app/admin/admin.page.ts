import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { AuthService } from '../services/auth.service';
import { ImageService } from '../services/image.service';
import { SafeUrl } from '@angular/platform-browser';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';

@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
  standalone: false,
})
export class AdminPage implements OnInit {
  @ViewChild('adminSigCanvas') adminSigCanvas!: ElementRef<HTMLCanvasElement>;
  private adminSignaturePad: any = null;

  isLoggedIn: boolean = false;
  activeTab: string = 'dashboard';

  pendingUsers: any[] = [];
  selectedUser: any = null;

  totalPendingCount: number = 0;
  totalApprovedCount: number = 0;
  totalRejectedCount: number = 0;
  totalUsersCount: number = 0;
  totalStudentsCount: number = 0;
  totalAlumniCount: number = 0;
  recentUsers: any[] = [];

  adminNotes: string = '';

  pendingAlumniVerification: any[] = [];
  verifiedAlumni: any[] = [];
  verifiedAlumniSearch: string = '';
  expandedAlumniId: string | null = null;

  showApprovalModal = false;
  approvalTargetAlumnus: any = null;
  adminSigHasSig = false;
  isApprovingAlumni = false;
  currentAdminName = '';

  departments: any[] = [];

  alumni: any[] = [];
  filteredAlumni: any[] = [];
  showAlumniForm: boolean = false;
  editingAlumniId: string | null = null;
  selectedAlumni: any = null;
  selectedAlumniRole: string = 'user';
  showRoleManagementModal: boolean = false;

  newAlumni = {
    studentNumber: '',
    name: '',
    email: '',
    department: '',
    course: '',
    batch: ''
  };

  alumniSearchFilters = {
    name: '',
    department: '',
    batch: '',
    userType: ''
  };

  showCreateUserForm: boolean = false;
  isCreatingUser: boolean = false;
  createUserCourses: string[] = [];
  createUserData = {
    firstName: '',
    lastName: '',
    email: '',
    userType: 'alumni' as 'alumni' | 'hod',
    department: '',
    studentNumber: '',
    course: '',
    graduationYear: ''
  };

  allAppUsers: any[] = [];
  nominationSearch = '';
  nominationSearchResults: any[] = [];
  nominationTarget: any = null;
  nominationForm = { inspireCategory: 'service', points: 5, reason: '' };
  nominationProofFile: File | null = null;
  nominationProofFileName = '';
  isSubmittingNomination = false;
  nominations: any[] = [];
  isLoadingNominations = false;

  events: any[] = [];
  showEventForm: boolean = false;
  editingEventId: string | null = null;
  isSubmittingEvent: boolean = false;
  selectedEvent: any = null;
  newEvent = {
    title: '', description: '', date: '', time: '',
    endDate: '', endTime: '',
    location: '', eventType: 'global', maxParticipants: '',
    coverImageBase64: '',
    coverImageUrl: '',
    coverImageFileName: '',
    eventCategory: 'regular', pointValue: 10,
    inspireCategory: 'service'
  };

  private coverImageFile: File | null = null;

  searchTerm: string = '';
  filterByRole: string = '';
  filterByDepartment: string = '';
  filterByBatch: string = '';
  filteredUsers: any[] = [];
  paginatedUsers: any[] = [];
  currentPage: number = 1;
  itemsPerPage: number = 10;
  totalPages: number = 1;

  newDepartmentName: string = '';
  newDepartmentColor: string = '#1E5128';
  showDepartmentEditModal: boolean = false;
  editingDepartmentId: string | null = null;
  editingDepartmentName: string = '';
  editingDepartmentColor: string = '#1E5128';
  newCourseName: string = '';
  departmentSearchTerm: string = '';
  selectedDepartmentId: string | null = null;
  showDepartmentForm: boolean = false;
  showCourseForm: boolean = false;
  isLoadingDepts: boolean = false;
  isRefreshing: boolean = false;
  departmentMap: {[id: string]: string} = {};
  departmentColorOptions: string[] = [
    '#1E5128',
    '#2563eb',
    '#7c3aed',
    '#dc2626',
    '#ea580c',
    '#0891b2',
    '#be123c',
    '#4f46e5'
  ];

  constructor(
    private router: Router,
    private authService: AuthService,
    private imageService: ImageService,
    private alertCtrl: AlertController
  ) {}

  ngOnInit() {
    if (this.authService.isLoggedIn()) {
      this.authService.isAdmin().then(async isAdmin => {
        if (isAdmin) {
          this.isLoggedIn = true;
          const currentUser = this.authService.getCurrentUser();
          if (currentUser) {
            const profile = await this.authService.getUserProfile(currentUser.uid);
            this.currentAdminName = profile
              ? `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || currentUser.email || 'Admin'
              : currentUser.email || 'Admin';
          }
          this.loadPendingUsers();
          this.loadDepartments();
          this.loadAlumni();
          this.loadPendingAlumniVerification();
          this.loadEvents();
        } else {
          this.router.navigate(['/login']);
        }
      });
    } else {
      this.router.navigate(['/login']);
    }
  }

  private async showAlert(header: string, message: string): Promise<void> {
    const alert = await this.alertCtrl.create({ header, message, buttons: ['OK'] });
    await alert.present();
  }

  private async showConfirm(header: string, message: string): Promise<boolean> {
    return new Promise(async resolve => {
      const alert = await this.alertCtrl.create({
        header,
        message,
        buttons: [
          { text: 'Cancel', role: 'cancel', handler: () => resolve(false) },
          { text: 'Confirm', cssClass: 'alert-button-danger', handler: () => resolve(true) }
        ]
      });
      await alert.present();
    });
  }

  private async showPrompt(header: string, placeholder: string = ''): Promise<string | null> {
    return new Promise(async resolve => {
      const alert = await this.alertCtrl.create({
        header,
        inputs: [{ name: 'value', type: 'text', placeholder }],
        buttons: [
          { text: 'Cancel', role: 'cancel', handler: () => resolve(null) },
          { text: 'Submit', handler: data => resolve(data['value'] !== undefined ? data['value'] : '') }
        ]
      });
      await alert.present();
    });
  }

  async loadPendingUsers() {
    try {
      this.pendingUsers = await this.authService.getPendingUsers();
      await this.calculateStats();
      this.filterAndPaginateUsers();
      if (this.pendingUsers.length > 0 && !this.selectedUser) {
        this.selectUserForDetail(this.pendingUsers[0]);
      }
    } catch (error) {
      console.error('Error loading pending users:', error);
    }
  }

  async calculateStats() {
    try {
      const allUsers = await this.authService.getAllUsers();
      const appUsers = allUsers.filter((u: any) => u.userType === 'student' || u.userType === 'alumni');
      this.allAppUsers = appUsers;
      this.totalUsersCount = appUsers.length;
      this.totalStudentsCount = appUsers.filter((u: any) => u.userType === 'student').length;
      this.totalAlumniCount = appUsers.filter((u: any) => u.userType === 'alumni').length;
      this.totalPendingCount = appUsers.filter((u: any) => u.status === 'pending').length;
      this.totalApprovedCount = appUsers.filter((u: any) => u.status === 'approved').length;
      this.totalRejectedCount = appUsers.filter((u: any) => u.status === 'rejected').length;
      this.recentUsers = appUsers
        .filter((u: any) => u.status !== 'rejected')
        .sort((a: any, b: any) => this.getDateTime(b.createdAt || b.joinDate) - this.getDateTime(a.createdAt || a.joinDate))
        .slice(0, 5);
    } catch (error) {
      console.error('Error calculating stats:', error);
    }
  }

  private getDateTime(value: any): number {
    if (!value) return 0;
    if (value.toMillis) return value.toMillis();
    if (value.toDate) return value.toDate().getTime();
    return new Date(value).getTime() || 0;
  }

  formatUserDate(user: any): string {
    const value = user?.createdAt || user?.joinDate;
    if (!value) return 'Recently';
    const date = value.toDate ? value.toDate() : new Date(value);
    return isNaN(date.getTime()) ? 'Recently' : date.toLocaleDateString();
  }

  get batchYears(): number[] {
    const current = new Date().getFullYear();
    const years: number[] = [];
    for (let y = current; y >= 1990; y--) years.push(y);
    return years;
  }

  filterAndPaginateUsers() {
    this.filteredUsers = this.pendingUsers.filter(user => {
      const fullName = (user.firstName + ' ' + user.lastName).toLowerCase();
      const email = (user.email || '').toLowerCase();
      const searchLower = this.searchTerm.toLowerCase();
      const matchesSearch = !this.searchTerm ||
        fullName.includes(searchLower) ||
        email.includes(searchLower);
      const matchesRole = !this.filterByRole || user.userType === this.filterByRole;
      const matchesDept = !this.filterByDepartment || user.department === this.filterByDepartment;
      const matchesBatch = !this.filterByBatch ||
        String(user.graduationYear) === this.filterByBatch;
      return matchesSearch && matchesRole && matchesDept && matchesBatch;
    });
    this.totalPages = Math.ceil(this.filteredUsers.length / this.itemsPerPage) || 1;
    if (this.currentPage > this.totalPages) this.currentPage = 1;
    this.paginatedUsers = this.getPaginatedUsers();
  }

  getPaginatedUsers(): any[] {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredUsers.slice(startIndex, startIndex + this.itemsPerPage);
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.paginatedUsers = this.getPaginatedUsers();
    }
  }

  previousPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.paginatedUsers = this.getPaginatedUsers();
    }
  }

  selectUserForDetail(user: any) {
    this.selectedUser = user;
    this.adminNotes = '';
  }

  async approveUser(userId: string) {
    try {
      await this.authService.approveUser(userId);
      if (this.selectedUser?.id === userId) {
        this.selectedUser = { ...this.selectedUser, status: 'approved' };
      }
      this.pendingUsers = this.pendingUsers.filter(u => u.id !== userId);
      this.filterAndPaginateUsers();
      await this.calculateStats();
      await this.showAlert('Approved', 'User approved successfully. They can now log in.');
    } catch (error) {
      console.error('Error approving user:', error);
      await this.showAlert('Error', 'Failed to approve user. Please try again.');
    }
  }

  async rejectUser(userId: string) {
    const reason = await this.showPrompt('Rejection Reason', 'Enter reason (optional)');
    if (reason !== null) {
      try {
        await this.authService.rejectUser(userId, reason);
        if (this.selectedUser?.id === userId) {
          this.selectedUser = { ...this.selectedUser, status: 'rejected' };
        }
        this.pendingUsers = this.pendingUsers.filter(u => u.id !== userId);
        this.filterAndPaginateUsers();
        await this.calculateStats();
        await this.showAlert('Rejected', 'User has been rejected.');
      } catch (error) {
        console.error('Error rejecting user:', error);
        await this.showAlert('Error', 'Failed to reject user. Please try again.');
      }
    }
  }

  async loadPendingAlumniVerification() {
    try {
      [this.pendingAlumniVerification, this.verifiedAlumni] = await Promise.all([
        this.authService.getPendingAlumniVerification(),
        this.authService.getVerifiedAlumni()
      ]);
    } catch (error) {
      console.error('Error loading alumni verification:', error);
    }
  }

  getImageSafeUrl(value: string): SafeUrl | string {
    if (!value) return '';
    if (value.startsWith('http')) return value;
    return this.imageService.base64ToSafeUrl(value, 'image/jpeg');
  }

  getAlumniImageUrl(record: any): string {
    return record.alumniGradPhotoUrl || record.alumniIdUrl || record.alumniIdBase64 || '';
  }

  hasAlumniImage(record: any): boolean {
    return !!(record.alumniGradPhotoUrl || record.alumniIdUrl || record.alumniIdBase64);
  }

  getEventCoverSrc(ev: any): string {
    if (ev.coverImageUrl) return ev.coverImageUrl;
    if (ev.coverImageBase64) return `data:image/jpeg;base64,${ev.coverImageBase64}`;
    return '';
  }

  hasEventCover(ev: any): boolean {
    return !!(ev.coverImageUrl || ev.coverImageBase64);
  }

  getNewEventCoverPreview(): string {
    if (this.newEvent.coverImageBase64) return `data:image/jpeg;base64,${this.newEvent.coverImageBase64}`;
    if (this.newEvent.coverImageUrl) return this.newEvent.coverImageUrl;
    return '';
  }

  hasNewEventCover(): boolean {
    return !!(this.newEvent.coverImageBase64 || this.newEvent.coverImageUrl);
  }

  downloadAlumniId(alumniId: any) {
    const url = alumniId.alumniIdUrl || alumniId.alumniIdBase64 || '';
    const fileName = alumniId.alumniIdFileName || 'alumni-id.jpg';
    if (!url) return;
    if (url.startsWith('http')) {
      window.open(url, '_blank');
    } else {
      this.imageService.downloadBase64File(url, fileName, 'image/jpeg');
    }
  }

  openApprovalModal(alumnus: any) {
    this.approvalTargetAlumnus = alumnus;
    this.adminSigHasSig = false;
    this.showApprovalModal = true;
    this.initAdminSignaturePad();
  }

  async initAdminSignaturePad() {
    await new Promise(r => setTimeout(r, 150));
    if (!this.adminSigCanvas?.nativeElement) return;
    const { default: SignaturePad } = await import('signature_pad');
    const canvas = this.adminSigCanvas.nativeElement;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    this.adminSignaturePad = new SignaturePad(canvas, {
      backgroundColor: 'rgba(0,0,0,0)',
      penColor: '#111827',
      minWidth: 1.5,
      maxWidth: 3,
    });
    this.adminSignaturePad.addEventListener('endStroke', () => {
      this.adminSigHasSig = !this.adminSignaturePad.isEmpty();
    });
  }

  clearAdminSignaturePad() {
    this.adminSignaturePad?.clear();
    this.adminSigHasSig = false;
  }

  private async getAdminSignatureFile(): Promise<File | undefined> {
    if (!this.adminSignaturePad || this.adminSignaturePad.isEmpty()) return undefined;
    const dataUrl = this.adminSignaturePad.toDataURL('image/png');
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], 'admin-signature.png', { type: 'image/png' });
  }

  async confirmApproval() {
    if (!this.approvalTargetAlumnus || !this.adminSigHasSig) return;
    this.isApprovingAlumni = true;
    try {
      const signatureFile = await this.getAdminSignatureFile();
      await this.authService.verifyAlumniId(
        this.approvalTargetAlumnus.id,
        'approved',
        '',
        signatureFile,
        this.currentAdminName
      );
      const approved = this.pendingAlumniVerification.find(a => a.id === this.approvalTargetAlumnus.id);
      this.pendingAlumniVerification = this.pendingAlumniVerification.filter(a => a.id !== this.approvalTargetAlumnus.id);
      if (approved) {
        this.verifiedAlumni = [{ ...approved, alumniIdVerificationStatus: 'approved' }, ...this.verifiedAlumni];
      }
      this.showApprovalModal = false;
    } catch (error) {
      console.error('Error approving alumni ID:', error);
      await this.showAlert('Error', 'Failed to approve alumni ID.');
    } finally {
      this.isApprovingAlumni = false;
    }
  }

  async rejectAlumniId(userId: string) {
    const reason = await this.showPrompt('Rejection Reason', 'Enter reason for rejection');
    if (reason !== null) {
      try {
        await this.authService.verifyAlumniId(userId, 'rejected', reason);
        this.pendingAlumniVerification = this.pendingAlumniVerification.filter(a => a.id !== userId);
      } catch (error) {
        console.error('Error rejecting alumni ID:', error);
        await this.showAlert('Error', 'Failed to reject alumni ID.');
      }
    }
  }

  async loadDepartments() {
    try {
      this.isLoadingDepts = true;
      this.departments = await this.authService.getDepartments();
      this.departmentMap = {};
      this.departments.forEach(dept => {
        this.departmentMap[dept.id] = dept.name;
      });
    } catch (error) {
      console.error('Error loading departments:', error);
    } finally {
      this.isLoadingDepts = false;
    }
  }

  getDepartmentName(departmentId: string): string {
    if (!departmentId) return 'N/A';
    return this.departmentMap[departmentId] || departmentId;
  }

  getTotalCourses(): number {
    return this.departments.reduce((total, dept) => total + (dept.courses?.length || 0), 0);
  }

  getDepartmentsWithCourses(): number {
    return this.departments.filter(dept => (dept.courses?.length || 0) > 0).length;
  }

  getDepartmentColor(dept: any): string {
    if (dept?.color) return dept.color;
    const source = String(dept?.id || dept?.name || '');
    const palette = this.departmentColorOptions;
    const index = Array.from(source).reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length;
    return palette[index] || '#1E5128';
  }

  getDepartmentSoftColor(dept: any): string {
    return this.hexToRgba(this.getDepartmentColor(dept), 0.12);
  }

  getDepartmentBorderColor(dept: any): string {
    return this.hexToRgba(this.getDepartmentColor(dept), 0.35);
  }

  private hexToRgba(hex: string, alpha: number): string {
    const cleanHex = hex.replace('#', '');
    const value = cleanHex.length === 3
      ? cleanHex.split('').map(char => char + char).join('')
      : cleanHex;
    const numeric = parseInt(value, 16);
    const red = (numeric >> 16) & 255;
    const green = (numeric >> 8) & 255;
    const blue = numeric & 255;
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  get filteredVerifiedAlumni(): any[] {
    const term = this.verifiedAlumniSearch.toLowerCase().trim();
    if (!term) return this.verifiedAlumni;
    return this.verifiedAlumni.filter(a =>
      `${a.firstName} ${a.lastName}`.toLowerCase().includes(term) ||
      (a.email || '').toLowerCase().includes(term) ||
      (a.studentNumber || '').toLowerCase().includes(term) ||
      (this.getDepartmentName(a.department) || '').toLowerCase().includes(term)
    );
  }

  get filteredDepartments(): any[] {
    if (!this.departmentSearchTerm.trim()) {
      return this.departments;
    }

    const searchLower = this.departmentSearchTerm.toLowerCase();
    return this.departments
      .map((dept: any) => {
        const filteredCourses = dept.courses.filter((course: string) =>
          course.toLowerCase().includes(searchLower)
        );

        if (
          dept.name.toLowerCase().includes(searchLower) ||
          filteredCourses.length > 0
        ) {
          return {
            ...dept,
            courses: dept.name.toLowerCase().includes(searchLower)
              ? dept.courses
              : filteredCourses
          };
        }
        return null;
      })
      .filter((dept: any) => dept !== null);
  }

  toggleDepartmentForm() {
    this.showDepartmentForm = !this.showDepartmentForm;
    if (!this.showDepartmentForm) {
      this.newDepartmentName = '';
      this.newDepartmentColor = '#1E5128';
    }
  }

  toggleCourseForm(departmentId: string) {
    this.selectedDepartmentId = this.selectedDepartmentId === departmentId ? null : departmentId;
    this.newCourseName = '';
    this.showCourseForm = this.selectedDepartmentId !== null;
  }

  async addDepartment() {
    if (!this.newDepartmentName.trim()) {
      await this.showAlert('Required', 'Please enter a department name.');
      return;
    }
    try {
      await this.authService.addDepartment(this.newDepartmentName, this.newDepartmentColor);
      this.newDepartmentName = '';
      this.newDepartmentColor = '#1E5128';
      this.showDepartmentForm = false;
      await this.loadDepartments();
    } catch (error) {
      console.error('Error adding department:', error);
      await this.showAlert('Error', 'Failed to add department.');
    }
  }

  async addCourse(departmentId: string) {
    if (!this.newCourseName.trim()) {
      await this.showAlert('Required', 'Please enter a course name.');
      return;
    }
    try {
      await this.authService.addCourse(departmentId, this.newCourseName);
      const department = this.departments.find(d => d.id === departmentId);
      if (department) department.courses.push(this.newCourseName);
      this.newCourseName = '';
      this.showCourseForm = false;
      this.selectedDepartmentId = null;
    } catch (error) {
      console.error('Error adding course:', error);
      await this.showAlert('Error', 'Failed to add course.');
    }
  }

  async deleteCourse(departmentId: string, courseIndex: number) {
    const department = this.departments.find(d => d.id === departmentId);
    const courseName = department?.courses?.[courseIndex] || 'this course';
    const confirmed = await this.showConfirm('Delete Course', `Are you sure you want to delete "${courseName}"?`);
    if (!confirmed) return;
    try {
      await this.authService.deleteCourse(departmentId, courseIndex);
      if (department) department.courses.splice(courseIndex, 1);
    } catch (error) {
      console.error('Error deleting course:', error);
      await this.showAlert('Error', 'Failed to delete course.');
    }
  }

  async editDepartment(departmentId: string, currentName: string) {
    const dept = this.departments.find(d => d.id === departmentId);
    this.editingDepartmentId = departmentId;
    this.editingDepartmentName = currentName;
    this.editingDepartmentColor = this.getDepartmentColor(dept || { id: departmentId, name: currentName });
    this.showDepartmentEditModal = true;
  }

  closeDepartmentEditModal() {
    this.showDepartmentEditModal = false;
    this.editingDepartmentId = null;
    this.editingDepartmentName = '';
    this.editingDepartmentColor = '#1E5128';
  }

  async saveDepartmentEdit() {
    if (!this.editingDepartmentId) return;
    if (!this.editingDepartmentName.trim()) {
      await this.showAlert('Required', 'Please enter a department name.');
      return;
    }

    const departmentId = this.editingDepartmentId;
    const dept = this.departments.find(d => d.id === departmentId);
    const newName = this.editingDepartmentName.trim();
    const newColor = this.editingDepartmentColor || '#1E5128';
    const currentColor = this.getDepartmentColor(dept || { id: departmentId, name: newName });

    if (dept && newName === dept.name && newColor === currentColor) {
      this.closeDepartmentEditModal();
      return;
    }

    try {
      await this.authService.updateDepartment(departmentId, newName, newColor);
      if (dept) {
        dept.name = newName;
        dept.color = newColor;
      }
      this.departmentMap[departmentId] = newName;
      this.closeDepartmentEditModal();
    } catch (error) {
      console.error('Error updating department:', error);
      await this.showAlert('Error', 'Failed to update department.');
    }
  }

  async deleteDepartment(departmentId: string) {
    const confirmed = await this.showConfirm('Delete Department', 'Are you sure you want to delete this department?');
    if (confirmed) {
      try {
        await this.authService.deleteDepartment(departmentId);
        this.departments = this.departments.filter(d => d.id !== departmentId);
      } catch (error) {
        console.error('Error deleting department:', error);
        await this.showAlert('Error', 'Failed to delete department.');
      }
    }
  }

  async editCourse(departmentId: string, courseIndex: number, currentName: string) {
    const newName = await this.showPrompt('Rename Course', currentName);
    if (!newName || !newName.trim() || newName.trim() === currentName) return;
    try {
      await this.authService.updateCourse(departmentId, courseIndex, newName.trim());
      const dept = this.departments.find(d => d.id === departmentId);
      if (dept) dept.courses[courseIndex] = newName.trim();
    } catch (error) {
      console.error('Error renaming course:', error);
      await this.showAlert('Error', 'Failed to rename course.');
    }
  }

  async loadAlumni() {
    try {
      this.alumni = await this.authService.getAlumni();
      this.filterAlumni();
    } catch (error) {
      console.error('Error loading alumni:', error);
    }
  }

  filterAlumni() {
    this.filteredAlumni = this.alumni.filter(a => {
      if (a.source === 'registered' && a.status !== 'approved') return false;
      const nameMatch = a.name.toLowerCase().includes(this.alumniSearchFilters.name.toLowerCase());
      const deptMatch = this.alumniSearchFilters.department === '' || a.department === this.alumniSearchFilters.department;
      const batchMatch = this.alumniSearchFilters.batch === '' || a.batch === this.alumniSearchFilters.batch;
      const userTypeMatch = this.alumniSearchFilters.userType === '' || a.userType === this.alumniSearchFilters.userType;
      return nameMatch && deptMatch && batchMatch && userTypeMatch;
    });
  }

  toggleAlumniForm() {
    this.showAlumniForm = !this.showAlumniForm;
    if (this.showAlumniForm) this.showCreateUserForm = false;
    if (!this.showAlumniForm) this.resetAlumniForm();
  }

  toggleCreateUserForm() {
    this.showCreateUserForm = !this.showCreateUserForm;
    if (this.showCreateUserForm) this.showAlumniForm = false;
    if (!this.showCreateUserForm) this.resetCreateUserForm();
  }

  resetCreateUserForm() {
    this.createUserData = {
      firstName: '', lastName: '', email: '',
      userType: 'alumni', department: '',
      studentNumber: '', course: '', graduationYear: ''
    } as any;
    this.createUserCourses = [];
  }

  onCreateUserDeptChange() {
    const dept = this.departments.find((d: any) => d.id === this.createUserData.department);
    this.createUserCourses = dept?.courses || [];
    this.createUserData.course = '';
  }

  capitalizeCreateUserName(field: 'firstName' | 'lastName') {
    this.createUserData[field] = this.capitalizeName(this.createUserData[field]);
  }

  private capitalizeName(value: string): string {
    return (value || '').replace(/(^|[\s'-])([a-z])/g, (_, prefix: string, letter: string) => {
      return prefix + letter.toUpperCase();
    });
  }

  formatCreateUserStudentNumber() {
    this.createUserData.studentNumber = (this.createUserData.studentNumber || '')
      .replace(/\D/g, '')
      .slice(0, 10);
  }

  async createUser() {
    const { firstName, lastName, email, userType, department, studentNumber, course, graduationYear } = this.createUserData;
    const normalizedFirstName = this.capitalizeName(firstName.trim());
    const normalizedLastName = this.capitalizeName(lastName.trim());
    const normalizedStudentNumber = (studentNumber || '').replace(/\D/g, '').slice(0, 10);
    const isHOD = userType === 'hod';
    if (!normalizedFirstName || !normalizedLastName || !email.trim() || !department) {
      await this.showAlert('Required', 'Please fill in all required fields.');
      return;
    }
    if (!isHOD && normalizedStudentNumber.length !== 10) {
      await this.showAlert('Invalid Student Number', 'Student number must be exactly 10 digits.');
      return;
    }
    if (userType === 'alumni' && !graduationYear.trim()) {
      await this.showAlert('Required', 'Please enter the graduation year for alumni.');
      return;
    }
    this.isCreatingUser = true;
    try {
      await this.authService.adminCreateUser(email, {
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        userType: isHOD ? 'alumni' : userType as 'student' | 'alumni',
        role: isHOD ? 'hod' : 'user',
        department,
        studentNumber: isHOD ? '' : normalizedStudentNumber,
        course, graduationYear
      });
      this.showCreateUserForm = false;
      this.resetCreateUserForm();
      await this.loadAlumni();
      await this.calculateStats();
      await this.showAlert('Account Created', `Account created successfully! A password setup email has been sent to ${email}.`);
    } catch (error: any) {
      const msg = error?.message || 'Failed to create account.';
      await this.showAlert('Error', msg.includes('email-already-in-use') ? 'This email is already registered.' : msg);
    } finally {
      this.isCreatingUser = false;
    }
  }

  resetAlumniForm() {
    this.newAlumni = { studentNumber: '', name: '', email: '', department: '', course: '', batch: '' };
    this.editingAlumniId = null;
  }

  async saveAlumni() {
    const { studentNumber, name, email, department, course, batch } = this.newAlumni;
    if (!studentNumber.trim() || !name.trim() || !email.trim() || !department.trim() || !course.trim() || !batch.trim()) {
      await this.showAlert('Required', 'Please fill in all required fields.');
      return;
    }
    try {
      if (this.editingAlumniId) {
        await this.authService.updateAlumni(this.editingAlumniId, this.newAlumni);
        const index = this.alumni.findIndex(a => a.id === this.editingAlumniId);
        if (index !== -1) this.alumni[index] = { ...this.alumni[index], ...this.newAlumni };
      } else {
        await this.authService.addAlumni(this.newAlumni);
        await this.loadAlumni();
      }
      this.resetAlumniForm();
      this.showAlumniForm = false;
      this.filterAlumni();
    } catch (error) {
      console.error('Error saving alumni:', error);
      await this.showAlert('Error', 'Failed to save alumni record.');
    }
  }

  async editAlumni(alumniId: string) {
    const alumniToEdit = this.alumni.find(a => a.id === alumniId);
    if (!alumniToEdit) return;
    if (alumniToEdit.source === 'registered') {
      await this.showAlert('Not Allowed', 'Registered alumni users cannot be edited directly. They are managed through their user accounts.');
      return;
    }
    this.newAlumni = {
      studentNumber: alumniToEdit.studentNumber || '',
      name: alumniToEdit.name || '',
      email: alumniToEdit.email || '',
      department: alumniToEdit.department || '',
      course: alumniToEdit.course || '',
      batch: alumniToEdit.batch || ''
    };
    this.editingAlumniId = alumniId;
    this.showAlumniForm = true;
  }

  async deleteAlumni(alumniId: string) {
    const alumniToDelete = this.alumni.find(a => a.id === alumniId);
    if (!alumniToDelete) return;

    const isRegistered = alumniToDelete.source === 'registered';
    const confirmed = await this.showConfirm(
      'Delete User',
      isRegistered
        ? `Permanently delete the account of "${alumniToDelete.name}"? This removes all their profile data.`
        : `Delete the alumni record for "${alumniToDelete.name}"?`
    );
    if (!confirmed) return;

    try {
      if (isRegistered) {
        await this.authService.deleteRegisteredUser(alumniId);
      } else {
        await this.authService.deleteAlumni(alumniId);
      }
      this.alumni = this.alumni.filter(a => a.id !== alumniId);
      if (this.selectedAlumni?.id === alumniId) this.selectedAlumni = null;
      this.filterAlumni();
      await this.calculateStats();
    } catch (error) {
      console.error('Error deleting user:', error);
      await this.showAlert('Error', 'Failed to delete user.');
    }
  }

  getUniqueBatches(): string[] {
    return Array.from(new Set(this.alumni.map(a => a.batch))).sort().reverse() as string[];
  }

  getUniqueDepartmentsForAlumni(): string[] {
    return Array.from(new Set(this.alumni.map(a => a.department))).sort() as string[];
  }

  selectAlumniForDetail(alumni: any) {
    this.selectedAlumni = alumni;
    this.selectedAlumniRole = alumni.role || 'user';
  }

  closeAlumniDetail() {
    this.selectedAlumni = null;
    this.showRoleManagementModal = false;
  }

  openRoleManagement() {
    this.showRoleManagementModal = true;
  }

  isReminding: boolean = false;

  hasIncompleteProfile(alumnus: any): boolean {
    return alumnus?.source === 'registered' &&
      (!alumnus.contactNumber || !alumnus.gender || !alumnus.address);
  }

  async remindUpdateProfile(userId: string) {
    if (this.isReminding) return;
    this.isReminding = true;
    try {
      await this.authService.createNotification(
        userId,
        'Complete Your Profile',
        'Your profile is incomplete. Please update your mobile number, sex, and address so others can connect with you better.',
        'info',
        '/profile'
      );
      await this.showAlert('Reminder Sent', 'A profile update reminder has been sent to this user.');
    } catch (error) {
      console.error('Error sending reminder:', error);
      await this.showAlert('Error', 'Failed to send reminder.');
    } finally {
      this.isReminding = false;
    }
  }

  async updateAlumniRole(newRole: string) {
    if (!this.selectedAlumni || this.selectedAlumni.source !== 'registered') {
      await this.showAlert('Not Allowed', 'Roles can only be changed for registered alumni users.');
      return;
    }
    if (this.selectedAlumni.userType !== 'alumni') {
      await this.showAlert('Not Allowed', 'HOD role can only be assigned to Alumni accounts.');
      return;
    }
    const allowedRoles: string[] = ['user', 'hod'];
    if (!allowedRoles.includes(newRole)) {
      await this.showAlert('Invalid Role', 'Only "User" and "HOD" roles can be assigned here.');
      return;
    }
    try {
      await this.authService.updateUserRole(this.selectedAlumni.id, newRole);
      this.selectedAlumni.role = newRole;
      const index = this.alumni.findIndex(a => a.id === this.selectedAlumni.id);
      if (index !== -1) this.alumni[index].role = newRole;
      const label = newRole === 'hod' ? 'Head of Department (HOD)' : 'User';
      await this.showAlert('Role Updated', `${this.selectedAlumni.name} is now assigned as: ${label}.`);
    } catch (error) {
      console.error('Error updating alumni role:', error);
      await this.showAlert('Error', 'Failed to update user role.');
    }
  }

  async loadEvents() {
    try {
      this.events = await this.authService.getGlobalEvents();
    } catch (error) {
      console.error('Error loading events:', error);
    }
  }

  toggleEventForm() {
    this.showEventForm = !this.showEventForm;
    if (!this.showEventForm) this.resetEventForm();
  }

  resetEventForm() {
    this.newEvent = {
      title: '', description: '', date: '', time: '',
      endDate: '', endTime: '',
      location: '', eventType: 'global', maxParticipants: '',
      coverImageBase64: '', coverImageUrl: '', coverImageFileName: '',
      eventCategory: 'regular', pointValue: 10,
      inspireCategory: 'service'
    };
    this.coverImageFile = null;
    this.editingEventId = null;
  }

  onCoverImageSelected(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;
    this.coverImageFile = file;
    this.newEvent.coverImageFileName = file.name;
    this.newEvent.coverImageUrl = '';
    const reader = new FileReader();
    reader.onload = (e: any) => {
      this.newEvent.coverImageBase64 = e.target.result.split(',')[1] || '';
    };
    reader.readAsDataURL(file);
  }

  removeCoverImage() {
    this.newEvent.coverImageBase64 = '';
    this.newEvent.coverImageUrl = '';
    this.newEvent.coverImageFileName = '';
    this.coverImageFile = null;
  }

  get todayDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  async saveEvent() {
    const today = new Date().toISOString().split('T')[0];
    if (this.newEvent.date && this.newEvent.date < today) {
      await this.showAlert('Invalid Date', 'Event date cannot be in the past.');
      return;
    }
    const { title, description, date, location, endDate, endTime } = this.newEvent;
    if (!title.trim() || !description.trim() || !date || !location.trim() || !endDate || !endTime) {
      await this.showAlert('Required', 'Please fill in Title, Description, Date, Location, End Date, and End Time.');
      return;
    }
    
    // Validate end date is not before start date
    if (endDate < date) {
      await this.showAlert('Invalid End Date', 'Event end date cannot be before the start date.');
      return;
    }
    
    // If same date, validate end time is after start time
    if (endDate === date && this.newEvent.time) {
      if (endTime <= this.newEvent.time) {
        await this.showAlert('Invalid End Time', 'Event end time must be after the start time.');
        return;
      }
    }
    
    this.isSubmittingEvent = true;
    try {
      const payload: any = {
        title: this.newEvent.title.trim(),
        description: this.newEvent.description.trim(),
        date: this.newEvent.date,
        time: this.newEvent.time,
        endDate: this.newEvent.endDate,
        endTime: this.newEvent.endTime,
        location: this.newEvent.location.trim(),
        eventType: this.newEvent.eventType,
        maxParticipants: this.newEvent.maxParticipants ? Number(this.newEvent.maxParticipants) : null,
        coverImageFileName: this.newEvent.coverImageFileName,
        eventCategory: this.newEvent.eventCategory,
        pointValue: this.newEvent.pointValue
      };
      if (this.coverImageFile) {
        payload.coverImageFile = this.coverImageFile;
      } else {
        payload.coverImageUrl = this.newEvent.coverImageUrl || '';
      }
      if (this.editingEventId) {
        await this.authService.updateGlobalEvent(this.editingEventId, payload);
      } else {
        await this.authService.addGlobalEvent(payload);
      }
      this.showEventForm = false;
      this.resetEventForm();
      await this.loadEvents();
      await this.showAlert('Success', this.editingEventId ? 'Event updated.' : 'Event created and published to Feeds.');
    } catch (error) {
      await this.showAlert('Error', 'Failed to save event.');
    } finally {
      this.isSubmittingEvent = false;
    }
  }

  editEvent(eventId: string) {
    const ev = this.events.find(e => e.id === eventId);
    if (!ev) return;
    this.newEvent = {
      title: ev.title || '',
      description: ev.description || '',
      date: ev.date || '',
      time: ev.time || '',
      endDate: ev.endDate || '',
      endTime: ev.endTime || '',
      location: ev.location || '',
      eventType: ev.eventType || 'global',
      maxParticipants: ev.maxParticipants || '',
      coverImageBase64: '',
      coverImageUrl: ev.coverImageUrl || '',
      coverImageFileName: ev.coverImageFileName || '',
      eventCategory: ev.eventCategory || 'regular',
      pointValue: ev.pointValue ?? 10,
      inspireCategory: ev.inspireCategory || 'service'
    };
    this.coverImageFile = null;
    this.editingEventId = eventId;
    this.showEventForm = true;
    this.selectedEvent = null;
  }

  async deleteEvent(eventId: string) {
    const confirmed = await this.showConfirm('Delete Event', 'Are you sure you want to delete this event? It will be removed from Feeds.');
    if (confirmed) {
      try {
        await this.authService.deleteGlobalEvent(eventId);
        this.events = this.events.filter(e => e.id !== eventId);
        if (this.selectedEvent?.id === eventId) this.selectedEvent = null;
      } catch (error) {
        await this.showAlert('Error', 'Failed to delete event.');
      }
    }
  }

  eventParticipants: any[] = [];
  loadingParticipants: boolean = false;
  showParticipantsForEvent: string | null = null;

  showQRModal: boolean = false;
  qrModalEvent: any = null;
  qrCodeDataUrl: string = '';
  attendanceList: any[] = [];
  isLoadingAttendance: boolean = false;
  showAttendanceInModal: boolean = false;
  isGeneratingQR: boolean = false;

  selectEventDetail(event: any) {
    const same = this.selectedEvent?.id === event.id;
    this.selectedEvent = same ? null : event;
    this.showParticipantsForEvent = null;
    this.eventParticipants = [];
  }

  async toggleParticipants(event: any) {
    if (this.showParticipantsForEvent === event.id) {
      this.showParticipantsForEvent = null;
      this.eventParticipants = [];
      return;
    }
    this.showParticipantsForEvent = event.id;
    this.loadingParticipants = true;
    try {
      this.eventParticipants = await this.authService.getUserProfiles(event.attendees || []);
    } catch {
      this.eventParticipants = [];
    } finally {
      this.loadingParticipants = false;
    }
  }

  formatEventDate(event: any): string {
    if (!event.date) return 'TBD';
    const d = new Date(`${event.date}T${event.time || '00:00'}`);
    return isNaN(d.getTime()) ? event.date : d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  formatEventTime(event: any): string {
    if (!event.time) return '';
    const [h, m] = event.time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  isEventPast(event: any): boolean {
    if (!event.date) return false;
    return new Date(`${event.date}T${event.time || '23:59'}`) < new Date();
  }

  isQRCodeAvailable(event: any): boolean {
    if (!event.endDate || !event.endTime) return true; // Allow QR if no end time set
    const eventEndDateTime = new Date(`${event.endDate}T${event.endTime}`);
    return new Date() < eventEndDateTime;
  }

  async showEventQR(event: any) {
    this.isGeneratingQR = true;
    this.qrModalEvent = event;
    this.showQRModal = true;
    this.attendanceList = [];
    this.showAttendanceInModal = false;
    this.qrCodeDataUrl = '';
    try {
      let token: string = event.qrToken;
      if (!token) {
        token = await this.authService.generateEventQRToken(event.id);
        const idx = this.events.findIndex(e => e.id === event.id);
        if (idx !== -1) this.events[idx].qrToken = token;
        this.qrModalEvent = { ...event, qrToken: token };
      }
      await this.renderQRCode(event.id, token);
      await this.loadEventAttendance(event.id);
    } catch {
      await this.showAlert('Error', 'Failed to generate QR code.');
      this.closeQRModal();
    } finally {
      this.isGeneratingQR = false;
    }
  }

  async refreshQRCode() {
    if (!this.qrModalEvent) return;
    this.isGeneratingQR = true;
    this.qrCodeDataUrl = '';
    try {
      const token = await this.authService.generateEventQRToken(this.qrModalEvent.id);
      const idx = this.events.findIndex(e => e.id === this.qrModalEvent.id);
      if (idx !== -1) this.events[idx].qrToken = token;
      this.qrModalEvent = { ...this.qrModalEvent, qrToken: token };
      await this.renderQRCode(this.qrModalEvent.id, token);
    } catch {
      await this.showAlert('Error', 'Failed to refresh QR code.');
    } finally {
      this.isGeneratingQR = false;
    }
  }

  private async renderQRCode(eventId: string, token: string) {
    const payload = `josenianlink::${eventId}::${token}`;
    this.qrCodeDataUrl = await QRCode.toDataURL(payload, {
      width: 280,
      margin: 2,
      color: { dark: '#111827', light: '#ffffff' },
      errorCorrectionLevel: 'M'
    });
  }

  async loadEventAttendance(eventId: string) {
    this.isLoadingAttendance = true;
    try {
      this.attendanceList = await this.authService.getEventAttendance(eventId);
    } catch {
      this.attendanceList = [];
    } finally {
      this.isLoadingAttendance = false;
    }
  }

  toggleAttendanceList() {
    this.showAttendanceInModal = !this.showAttendanceInModal;
    if (this.showAttendanceInModal && this.qrModalEvent) {
      this.loadEventAttendance(this.qrModalEvent.id);
    }
  }

  closeQRModal() {
    this.showQRModal = false;
    this.qrModalEvent = null;
    this.qrCodeDataUrl = '';
    this.attendanceList = [];
    this.showAttendanceInModal = false;
  }

  formatAttendanceTime(scannedAt: any): string {
    if (!scannedAt) return '';
    const d = scannedAt.toDate ? scannedAt.toDate() : new Date(scannedAt);
    return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true
    });
  }

  adjustPointsUserId: string = '';
  adjustPointsAmount: number = 0;
  adjustPointsReason: string = '';
  leaderboard: any[] = [];
  isLoadingLeaderboard: boolean = false;

  onEventCategoryChange() {
    this.newEvent.pointValue = this.authService.getDefaultPoints(this.newEvent.eventCategory);
  }

  async adjustUserPoints(userId: string) {
    if (!this.adjustPointsAmount || !this.adjustPointsReason.trim()) {
      await this.showAlert('Required', 'Enter both an amount and a reason.');
      return;
    }
    try {
      await this.authService.adminAdjustPoints(userId, this.adjustPointsAmount, this.adjustPointsReason);
      this.adjustPointsAmount = 0;
      this.adjustPointsReason = '';
      await this.showAlert('Done', `Points adjusted by ${this.adjustPointsAmount > 0 ? '+' : ''}${this.adjustPointsAmount}.`);
    } catch {
      await this.showAlert('Error', 'Failed to adjust points.');
    }
  }

  async loadLeaderboard() {
    this.isLoadingLeaderboard = true;
    try {
      this.leaderboard = await this.authService.getLeaderboard(10);
    } catch {
      this.leaderboard = [];
    } finally {
      this.isLoadingLeaderboard = false;
    }
  }

  activeDashboardEventId: string = '';
  dashboardEvent: any = null;
  dashboardAttendees: any[] = [];
  filteredDashboardAttendees: any[] = [];
  dashboardSearch: string = '';
  dashboardStatusFilter: string = 'all';
  isLoadingDashboard: boolean = false;
  dashboardStats = { registered: 0, attended: 0, noShows: 0, rate: 0 };
  chartPoints: { x: number; y: number; label: string; count: number }[] = [];

  async selectDashboardEvent(eventId: string) {
    this.dashboardEvent = this.events.find((e: any) => e.id === eventId) || null;
    if (!this.dashboardEvent) return;
    await this.loadDashboardData();
  }

  async loadDashboardData() {
    if (!this.dashboardEvent) return;
    this.isLoadingDashboard = true;
    try {
      const attendance = await this.authService.getEventAttendance(this.dashboardEvent.id);
      const registeredIds: string[] = this.dashboardEvent.attendees || [];
      let registeredProfiles: any[] = [];
      if (registeredIds.length > 0) {
        registeredProfiles = await this.authService.getUserProfiles(registeredIds);
      }

      const attendedMap = new Map<string, any>();
      attendance.forEach((a: any) => attendedMap.set(a.userId, a));

      this.dashboardAttendees = registeredProfiles.map((p: any) => {
        const record = attendedMap.get(p.id);
        return {
          id: p.id,
          name: `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.email || 'Unknown',
          initials: ((p.firstName?.charAt(0) || '') + (p.lastName?.charAt(0) || '')).toUpperCase() || 'U',
          course: p.course || '',
          department: p.department || '',
          userType: p.userType || '',
          scannedAt: record?.scannedAt || null,
          status: record ? 'attended' : 'no-show',
          photoUrl: p.photoUrl || '',
        };
      });

      attendance.forEach((a: any) => {
        if (!this.dashboardAttendees.find((u: any) => u.id === a.userId)) {
          this.dashboardAttendees.push({
            id: a.userId,
            name: a.userName || 'Unknown',
            initials: (a.userName || 'U').charAt(0).toUpperCase(),
            course: '', department: '', userType: a.userType || '',
            scannedAt: a.scannedAt, status: 'attended', photoUrl: '',
          });
        }
      });

      const attended = this.dashboardAttendees.filter((u: any) => u.status === 'attended').length;
      const registered = this.dashboardAttendees.length;
      this.dashboardStats = {
        registered,
        attended,
        noShows: registered - attended,
        rate: registered > 0 ? Math.round((attended / registered) * 100) : 0,
      };

      this.buildChartData(attendance);
      this.filterDashboardList();
    } catch (err) {
      console.error('Error loading attendance dashboard:', err);
    } finally {
      this.isLoadingDashboard = false;
    }
  }

  private buildChartData(attendance: any[]) {
    const sorted = attendance
      .filter((a: any) => a.scannedAt)
      .map((a: any) => ({ time: a.scannedAt.toDate ? a.scannedAt.toDate() : new Date(a.scannedAt) }))
      .sort((a: any, b: any) => a.time - b.time);

    if (sorted.length < 2) { this.chartPoints = []; return; }

    const minT = sorted[0].time.getTime();
    const maxT = sorted[sorted.length - 1].time.getTime();
    const rangeT = maxT - minT || 1;
    const W = 560, H = 120, padL = 40, padR = 20, padT = 10, padB = 28;
    const cW = W - padL - padR, cH = H - padT - padB;

    this.chartPoints = sorted.map((p: any, i: number) => ({
      x: padL + ((p.time.getTime() - minT) / rangeT) * cW,
      y: padT + cH - ((i + 1) / sorted.length) * cH,
      label: p.time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      count: i + 1,
    }));
  }

  get chartSvgPath(): string {
    const pts = this.chartPoints;
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const cpx = (pts[i - 1].x + pts[i].x) / 2;
      d += ` C ${cpx} ${pts[i - 1].y}, ${cpx} ${pts[i].y}, ${pts[i].x} ${pts[i].y}`;
    }
    return d;
  }

  get chartFillPath(): string {
    const pts = this.chartPoints;
    if (pts.length < 2) return '';
    const bottom = 148;
    let d = `M ${pts[0].x} ${bottom} L ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const cpx = (pts[i - 1].x + pts[i].x) / 2;
      d += ` C ${cpx} ${pts[i - 1].y}, ${cpx} ${pts[i].y}, ${pts[i].x} ${pts[i].y}`;
    }
    d += ` L ${pts[pts.length - 1].x} ${bottom} Z`;
    return d;
  }

  filterDashboardList() {
    this.filteredDashboardAttendees = this.dashboardAttendees.filter((u: any) => {
      const nameMatch = !this.dashboardSearch ||
        u.name.toLowerCase().includes(this.dashboardSearch.toLowerCase());
      const statusMatch = !this.dashboardStatusFilter || this.dashboardStatusFilter === 'all' ||
        u.status === this.dashboardStatusFilter;
      return nameMatch && statusMatch;
    });
  }

  formatDashboardTime(scannedAt: any): string {
    if (!scannedAt) return '—';
    const d = scannedAt.toDate ? scannedAt.toDate() : new Date(scannedAt);
    return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  exportAttendanceCSV() {
    if (!this.dashboardEvent) return;
    const headers = ['Name', 'Course', 'Department', 'Role', 'Time Scanned', 'Status'];
    const rows = this.filteredDashboardAttendees.map((u: any) => [
      u.name, u.course || '—', this.getDepartmentName(u.department),
      u.userType === 'alumni' ? 'Alumni' : 'Student',
      this.formatDashboardTime(u.scannedAt),
      u.status === 'attended' ? 'Attended' : 'No-show',
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${this.dashboardEvent.title}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  exportCSV() {
    const headers = ['Student Number', 'Name', 'Email', 'Department', 'Course', 'Batch/Year', 'Type', 'Status', 'Source'];
    const rows = this.filteredAlumni.map(a => [
      a.studentNumber || '',
      a.name || '',
      a.email || '',
      this.getDepartmentName(a.department),
      a.course || '',
      a.batch || '',
      a.userType === 'alumni' ? 'Alumni' : 'Student',
      a.status || '',
      a.source === 'registered' ? 'Registered' : 'Manual',
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `alumni-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  exportExcel() {
    const headers = ['Student Number', 'Name', 'Email', 'Department', 'Course', 'Batch/Year', 'Type', 'Status', 'Source'];
    const rows = this.filteredAlumni.map(a => [
      a.studentNumber || '',
      a.name || '',
      a.email || '',
      this.getDepartmentName(a.department),
      a.course || '',
      a.batch || '',
      a.userType === 'alumni' ? 'Alumni' : 'Student',
      a.status || '',
      a.source === 'registered' ? 'Registered' : 'Manual',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Alumni');
    XLSX.writeFile(wb, `alumni-${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  selectTab(tab: string) {
    this.activeTab = tab;
    if (tab === 'attendance' && this.leaderboard.length === 0) {
      this.loadLeaderboard();
    }
    if (tab === 'nominations' && this.nominations.length === 0) {
      this.loadNominations();
    }
  }

  searchNominationUsers() {
    if (!this.nominationSearch.trim()) {
      this.nominationSearchResults = [];
      return;
    }
    const term = this.nominationSearch.toLowerCase();
    this.nominationSearchResults = this.allAppUsers
      .filter((u: any) => {
        const name = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
        const email = (u.email || '').toLowerCase();
        return name.includes(term) || email.includes(term);
      })
      .slice(0, 8);
  }

  selectNominationTarget(user: any) {
    this.nominationTarget = user;
    this.nominationSearch = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    this.nominationSearchResults = [];
  }

  clearNominationTarget() {
    this.nominationTarget = null;
    this.nominationSearch = '';
    this.nominationSearchResults = [];
  }

  onNominationProofSelected(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;
    this.nominationProofFile = file;
    this.nominationProofFileName = file.name;
  }

  async loadNominations() {
    this.isLoadingNominations = true;
    try {
      this.nominations = await this.authService.getNominations();
    } catch (err) {
      console.error('Error loading nominations:', err);
    } finally {
      this.isLoadingNominations = false;
    }
  }

  async submitNomination() {
    if (!this.nominationTarget) {
      await this.showAlert('Missing Info', 'Please select a user to nominate.');
      return;
    }
    if (!this.nominationForm.reason.trim()) {
      await this.showAlert('Missing Info', 'Please provide a reason for the nomination.');
      return;
    }
    this.isSubmittingNomination = true;
    try {
      await this.authService.createNomination({
        nomineeId: this.nominationTarget.id || this.nominationTarget.uid,
        nomineeName: `${this.nominationTarget.firstName || ''} ${this.nominationTarget.lastName || ''}`.trim(),
        nomineeEmail: this.nominationTarget.email || '',
        nominatedBy: this.authService.getCurrentUser()?.uid || '',
        nominatedByName: this.currentAdminName,
        inspireCategory: this.nominationForm.inspireCategory,
        points: this.nominationForm.points,
        reason: this.nominationForm.reason,
        proofFile: this.nominationProofFile || undefined,
      });
      await this.showAlert('Nomination Submitted', `${this.nominationSearch} has been awarded ${this.nominationForm.points} INSPIRE points.`);
      this.nominationTarget = null;
      this.nominationSearch = '';
      this.nominationForm = { inspireCategory: 'service', points: 5, reason: '' };
      this.nominationProofFile = null;
      this.nominationProofFileName = '';
      await this.loadNominations();
    } catch (err) {
      console.error('Error submitting nomination:', err);
      await this.showAlert('Error', 'Failed to submit nomination. Please try again.');
    } finally {
      this.isSubmittingNomination = false;
    }
  }

  getNominationCategoryLabel(key: string): string {
    const map: Record<string, string> = {
      interiority: 'I - Interiority', nationalism: 'N - Nationalism',
      service: 'S - Service', pioneerism: 'P - Pioneerism',
      integrity: 'I - Integrity', reliability: 'R - Reliability',
      excellence: 'E - Excellence',
    };
    return map[key] || key;
  }

  formatNominationDate(createdAt: any): string {
    if (!createdAt) return '';
    const d = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  async refreshData() {
    this.isRefreshing = true;
    try {
      await Promise.all([
        this.loadPendingUsers(),
        this.loadDepartments(),
        this.loadAlumni(),
        this.loadPendingAlumniVerification(),
        this.loadEvents()
      ]);
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      this.isRefreshing = false;
    }
  }

  async logout() {
    try {
      await this.authService.logout();
      this.isLoggedIn = false;
      this.activeTab = 'dashboard';
      this.pendingUsers = [];
      this.departments = [];
      this.alumni = [];
      this.filteredAlumni = [];
      this.events = [];
      this.router.navigate(['/login']);
    } catch (error) {
      console.error('Logout error:', error);
    }
  }
}
