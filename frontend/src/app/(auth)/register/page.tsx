import { RegisterForm } from "@/components/auth/register-form";

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/50 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">AlgoTrader</h1>
          <p className="text-muted-foreground">Create your trading account</p>
        </div>
        <RegisterForm />
      </div>
    </div>
  );
}
