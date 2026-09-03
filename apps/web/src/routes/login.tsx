import { createFileRoute } from '@tanstack/react-router';
import { LoginForm } from '../components/LoginForm.tsx';

export const Route = createFileRoute('/login')({ component: LoginForm });
