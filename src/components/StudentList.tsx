import React from 'react';
import StudentsList from './StudentsList';
import { Student, Course, Enrollment, Payment } from '../types';

interface StudentListProps {
  students: Student[];
  courses: Course[];
  enrollments: Enrollment[];
  payments: Payment[];
  onRefresh: () => void;
  onActiveTabChange: (tab: string, enrollmentId?: number) => void;
}

export default function StudentList(props: StudentListProps) {
  return <StudentsList {...props} />;
}
