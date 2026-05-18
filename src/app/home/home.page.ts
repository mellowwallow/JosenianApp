import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Auth, authState } from '@angular/fire/auth';
import { Firestore, collection, query, where, onSnapshot } from '@angular/fire/firestore';
import { AuthService } from '../services/auth.service';
import { ChatService } from '../services/chat.service';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit, OnDestroy {
  user = {
    name: 'User',
    initials: 'U',
    firstName: '',
    lastName: '',
    bio: '',
    department: '',
    photoUrl: '',
  };

  notifications = 0;
  unreadChats = 0;
  private notifUnsubscribe: (() => void) | null = null;
  private chatUnsubscribe: (() => void) | null = null;

  dashboardCards = [
    { id: 1, title: 'My Department', shortLabel: 'Dept',     icon: 'business-outline',  value: '—', description: 'Department members',  color: 'primary'   },
    { id: 2, title: 'My Network',    shortLabel: 'Network',  icon: 'people-outline',    value: '—', description: 'Connections',         color: 'secondary' },
    { id: 3, title: 'History',       shortLabel: 'Events',   icon: 'time-outline',      value: '—', description: 'Events attended',     color: 'tertiary'  },
    { id: 4, title: 'Feeds',         shortLabel: 'Posts',    icon: 'newspaper-outline', value: '—', description: 'Your posts',          color: 'success'   },
  ];

  get greeting(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

  get todayDate(): string {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  constructor(
    private authService: AuthService,
    private router: Router,
    private auth: Auth,
    private firestore: Firestore,
    private chatService: ChatService
  ) {}

  async ngOnInit() {
    authState(this.auth).subscribe(async firebaseUser => {
      if (!firebaseUser) return;
      await this.loadUserProfile();
      await this.loadDashboardStats();
    });
    this.subscribeToUnreadCounts();
  }

  ngOnDestroy() {
    this.notifUnsubscribe?.();
    this.chatUnsubscribe?.();
  }

  private subscribeToUnreadCounts() {
    authState(this.auth).subscribe(user => {
      if (!user) return;

      const notifQ = query(
        collection(this.firestore, 'users', user.uid, 'notifications'),
        where('read', '==', false)
      );
      this.notifUnsubscribe = onSnapshot(notifQ, snapshot => {
        this.notifications = snapshot.size;
      });

      this.chatUnsubscribe = this.chatService.subscribeToUnreadChatCount(
        user.uid,
        count => { this.unreadChats = count; }
      );
    });
  }

  async loadUserProfile() {
    try {
      const currentUser = this.authService.getCurrentUser();
      if (!currentUser) return;

      const profile = await this.authService.getUserProfile(currentUser.uid);
      if (profile) {
        this.user.firstName = profile.firstName || '';
        this.user.lastName = profile.lastName || '';
        this.user.name = `${this.user.firstName} ${this.user.lastName}`.trim() || 'User';
        this.user.bio = profile.bio || '';
        this.user.department = profile.department || '';
        this.user.initials =
          (this.user.firstName.charAt(0) + this.user.lastName.charAt(0)).toUpperCase() || 'U';
        this.user.photoUrl = profile.photoUrl || '';
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  }

  async loadDashboardStats() {
    try {
      const currentUser = this.authService.getCurrentUser();
      const allUsers = await this.authService.getAllUsers();
      const approved = allUsers.filter((u: any) => u.status === 'approved' && u.role !== 'admin');

      const networkCount = currentUser
        ? ((await this.authService.getUserProfile(currentUser.uid))?.['friends'] || []).length
        : 0;
      this.updateCard(2, String(networkCount));

      if (this.user.department) {
        const depts = await this.authService.getDepartments();
        const myDept = depts.find(
          (d: any) => d.id === this.user.department || d.name === this.user.department
        );
        if (myDept?.name) this.user.department = myDept.name;
        this.updateCard(1, String(myDept?.members?.length ?? 0));
      }

      const events = await this.authService.getEvents();
      this.updateCard(3, String(events.length));

      if (currentUser) {
        const postCount = await this.authService.getUserPostCount(currentUser.uid);
        this.updateCard(4, String(postCount));
      }

    } catch (error) {
      console.error('Error loading dashboard stats:', error);
    }
  }

  private updateCard(id: number, value: string) {
    const card = this.dashboardCards.find(c => c.id === id);
    if (card) card.value = value;
  }

  goToProfile() {
    this.router.navigate(['/profile']);
  }

  goToCard(cardId: number) {
    const routes: { [key: number]: string } = {
      1: '/department',
      2: '/network',
      3: '/history',
      4: '/feeds'
    };
    const route = routes[cardId];
    if (route) this.router.navigate([route]);
  }

  goToMessages() {
    this.router.navigate(['/messages']);
  }

  goToNotifications() {
    this.router.navigate(['/notifications']);
  }

  goToScanner() {
    this.router.navigate(['/qr-scanner']);
  }
}
