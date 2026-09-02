export type ThemePreference = 'light' | 'dark' | 'system';
export type CurrentLearningLevel = 'none' | 'basic' | 'intermediate' | 'experienced';
export type LearningContentPriority = 'theory' | 'practice' | 'project';
export type StudyWeekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface UserSettings {
  emailNotifications: boolean;
  assignmentNotifications: boolean;
  deadlineReminders: boolean;
  deadline6hReminders: boolean;
  workspaceEmailUpdates: boolean;
  systemAnnouncements: boolean;
  learningInactivityDays: number;
  workspaceNotifications: boolean;
  learningReminders: boolean;
  weeklyDigest: boolean;
  publicProfile: boolean;
  showLearningProgress: boolean;
  allowWorkspaceInvites: boolean;
  theme: ThemePreference;
}

export interface StudyScheduleSlot {
  weekday: StudyWeekday;
  enabled: boolean;
  startTime: string;
  durationMinutes: number;
}

export interface UserLearningPreferences {
  learningGoal: string | null;
  careerGoal: string | null;
  currentLevel: CurrentLearningLevel | null;
  contentPriority: LearningContentPriority | null;
  weeklyStudyHours: number | null;
  interestedFields: string[];
  interestedTechnologies: string[];
  preferredLearningStyle: string[];
  remindersEnabled: boolean;
  reminderTime: string;
  adaptiveRecommendations: boolean;
  schedule: StudyScheduleSlot[];
  completedAt: string | null;
}

export interface UserLearningStats {
  xp: number;
  solvedCount: number;
  currentStreakDays: number;
  longestStreakDays: number;
  lastSolvedOn: string | null;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  emailNotifications: true,
  assignmentNotifications: true,
  deadlineReminders: true,
  deadline6hReminders: false,
  workspaceEmailUpdates: true,
  systemAnnouncements: true,
  learningInactivityDays: 3,
  workspaceNotifications: true,
  learningReminders: true,
  weeklyDigest: true,
  publicProfile: false,
  showLearningProgress: true,
  allowWorkspaceInvites: true,
  theme: 'system',
};

const DAYS: StudyWeekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const DEFAULT_LEARNING_PREFERENCES: UserLearningPreferences = {
  learningGoal: null,
  careerGoal: null,
  currentLevel: null,
  contentPriority: null,
  weeklyStudyHours: null,
  interestedFields: [],
  interestedTechnologies: [],
  preferredLearningStyle: [],
  remindersEnabled: true,
  reminderTime: '18:45',
  adaptiveRecommendations: true,
  schedule: DAYS.map((weekday) => ({
    weekday,
    enabled: weekday !== 'sat' && weekday !== 'sun',
    startTime: weekday === 'sat' || weekday === 'sun' ? '09:00' : '19:00',
    durationMinutes: 60,
  })),
  completedAt: null,
};
