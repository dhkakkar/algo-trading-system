import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/50 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">AlgoTrader</h1>
          <p className="text-muted-foreground">Algorithmic Trading Platform</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
