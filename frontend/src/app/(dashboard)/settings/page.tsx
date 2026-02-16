"use client";

import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/auth-store";
import apiClient from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, CheckCircle2, XCircle, Eye, EyeOff } from "lucide-react";

interface BrokerStatus {
  connected: boolean;
  broker: string;
  api_key: string | null;
  token_expiry: string | null;
  token_valid: boolean;
  login_url: string | null;
}

const TIMEZONE_OPTIONS = [
  { value: "Asia/Kolkata", label: "IST (India, +5:30)" },
  { value: "UTC", label: "UTC (+0:00)" },
  { value: "America/New_York", label: "US Eastern (ET)" },
  { value: "America/Chicago", label: "US Central (CT)" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST, +9:00)" },
  { value: "Asia/Singapore", label: "Singapore (SGT, +8:00)" },
  { value: "Asia/Dubai", label: "Dubai (GST, +4:00)" },
  { value: "Asia/Hong_Kong", label: "Hong Kong (HKT, +8:00)" },
];

export default function SettingsPage() {
  const { user } = useAuthStore();

  // Profile state
  const [fullName, setFullName] = useState(user?.full_name || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");

  // Broker state
  const [brokerStatus, setBrokerStatus] = useState<BrokerStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [brokerSaving, setBrokerSaving] = useState(false);
  const [brokerMessage, setBrokerMessage] = useState("");
  const [requestToken, setRequestToken] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<boolean | null>(null);

  // Chart settings
  const [chartTimezone, setChartTimezone] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("chart_timezone") || "Asia/Kolkata";
    return "Asia/Kolkata";
  });

  useEffect(() => {
    fetchBrokerStatus();
  }, []);

  const fetchBrokerStatus = async () => {
    try {
      const res = await apiClient.get<BrokerStatus>("/broker/status");
      setBrokerStatus(res.data);
      if (res.data.api_key) setApiKey(res.data.api_key);
    } catch {
      // Not connected yet
    }
  };

  const handleValidateToken = async () => {
    setValidating(true);
    setValidateResult(null);
    try {
      const res = await apiClient.get<BrokerStatus>("/broker/status?validate=true");
      setBrokerStatus(res.data);
      setValidateResult(res.data.token_valid);
    } catch {
      setValidateResult(false);
    } finally {
      setValidating(false);
    }
  };

  const handleProfileUpdate = async () => {
    setProfileSaving(true);
    setProfileMessage("");
    try {
      await apiClient.put("/users/me", { full_name: fullName });
      setProfileMessage("Profile updated successfully");
    } catch (err: any) {
      setProfileMessage(err.response?.data?.detail || "Failed to update profile");
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (newPassword !== confirmNewPassword) {
      setPasswordMessage("Passwords do not match");
      return;
    }
    setPasswordSaving(true);
    setPasswordMessage("");
    try {
      await apiClient.put("/users/me/password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPasswordMessage("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err: any) {
      setPasswordMessage(err.response?.data?.detail || "Failed to change password");
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleBrokerConnect = async () => {
    setBrokerSaving(true);
    setBrokerMessage("");
    try {
      await apiClient.post("/broker/connect", {
        api_key: apiKey,
        api_secret: apiSecret,
      });
      setBrokerMessage("Credentials saved. Use the login URL to authorize.");
      await fetchBrokerStatus();
    } catch (err: any) {
      setBrokerMessage(err.response?.data?.detail || "Failed to save credentials");
    } finally {
      setBrokerSaving(false);
    }
  };

  const handleBrokerCallback = async () => {
    setBrokerSaving(true);
    setBrokerMessage("");
    try {
      await apiClient.post("/broker/callback", { request_token: requestToken });
      setBrokerMessage("Broker connected successfully!");
      setRequestToken("");
      await fetchBrokerStatus();
    } catch (err: any) {
      setBrokerMessage(err.response?.data?.detail || "Failed to complete auth");
    } finally {
      setBrokerSaving(false);
    }
  };

  const handleBrokerDisconnect = async () => {
    try {
      await apiClient.post("/broker/disconnect");
      setBrokerMessage("Broker disconnected");
      await fetchBrokerStatus();
    } catch {
      setBrokerMessage("Failed to disconnect");
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account and broker connection
        </p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Update your personal information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user?.email || ""} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          {profileMessage && (
            <p className="text-sm text-muted-foreground">{profileMessage}</p>
          )}
          <Button onClick={handleProfileUpdate} disabled={profileSaving}>
            {profileSaving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current Password</Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New Password</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmNewPassword">Confirm New Password</Label>
            <Input
              id="confirmNewPassword"
              type="password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
            />
          </div>
          {passwordMessage && (
            <p className="text-sm text-muted-foreground">{passwordMessage}</p>
          )}
          <Button onClick={handlePasswordChange} disabled={passwordSaving}>
            {passwordSaving ? "Changing..." : "Change Password"}
          </Button>
        </CardContent>
      </Card>

      {/* Broker Connection */}
      <Card>
        <CardHeader>
          <CardTitle>Zerodha Kite Connect</CardTitle>
          <CardDescription>
            Connect your Zerodha account for live market data and trading
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status */}
          <div className="flex items-center space-x-2">
            <div
              className={`h-3 w-3 rounded-full ${
                brokerStatus?.connected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-sm font-medium">
              {brokerStatus?.connected ? "Connected" : "Not Connected"}
            </span>
          </div>

          {!brokerStatus?.connected && (
            <>
              {/* Step 1: API credentials */}
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Your Kite Connect API Key"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="apiSecret">API Secret</Label>
                <div className="relative">
                  <Input
                    id="apiSecret"
                    type={showSecret ? "text" : "password"}
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder="Your Kite Connect API Secret"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button onClick={handleBrokerConnect} disabled={brokerSaving || !apiKey || !apiSecret}>
                {brokerSaving ? "Saving..." : "Save & Get Login URL"}
              </Button>

              {/* Step 2: Login URL */}
              {brokerStatus?.login_url && (
                <div className="space-y-2 pt-4 border-t">
                  <p className="text-sm">
                    Step 2: Open the login URL below, login to Zerodha, and paste the
                    request_token from the redirect URL.
                  </p>
                  <a
                    href={brokerStatus.login_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline break-all"
                  >
                    {brokerStatus.login_url}
                  </a>
                </div>
              )}

              {/* Step 3: Request token */}
              {brokerStatus?.login_url && (
                <div className="space-y-2">
                  <Label htmlFor="requestToken">Request Token</Label>
                  <Input
                    id="requestToken"
                    value={requestToken}
                    onChange={(e) => setRequestToken(e.target.value)}
                    placeholder="Paste request_token from redirect URL"
                  />
                  <Button
                    onClick={handleBrokerCallback}
                    disabled={brokerSaving || !requestToken}
                  >
                    {brokerSaving ? "Connecting..." : "Complete Connection"}
                  </Button>
                </div>
              )}
            </>
          )}

          {brokerStatus?.connected && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                API Key: {brokerStatus.api_key}
              </p>
              {brokerStatus.token_expiry && (
                <p className="text-sm text-muted-foreground">
                  Token Expires:{" "}
                  <span className="font-medium text-foreground">
                    {new Date(brokerStatus.token_expiry).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: true,
                    })}
                  </span>
                </p>
              )}

              {/* Token validation */}
              <div className="flex items-center gap-3 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleValidateToken}
                  disabled={validating}
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${validating ? "animate-spin" : ""}`} />
                  {validating ? "Checking..." : "Validate Token"}
                </Button>
                {validateResult === true && (
                  <span className="flex items-center gap-1 text-sm text-green-500">
                    <CheckCircle2 className="h-4 w-4" />
                    Token is valid
                  </span>
                )}
                {validateResult === false && (
                  <span className="flex items-center gap-1 text-sm text-red-500">
                    <XCircle className="h-4 w-4" />
                    Token is invalid or expired
                  </span>
                )}
              </div>

              <Button variant="destructive" onClick={handleBrokerDisconnect}>
                Disconnect
              </Button>
            </div>
          )}

          {brokerMessage && (
            <p className="text-sm text-muted-foreground">{brokerMessage}</p>
          )}
        </CardContent>
      </Card>

      {/* Chart Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Chart Settings</CardTitle>
          <CardDescription>Configure chart display preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="timezone">Chart Timezone</Label>
            <select
              id="timezone"
              value={chartTimezone}
              onChange={(e) => {
                setChartTimezone(e.target.value);
                localStorage.setItem("chart_timezone", e.target.value);
              }}
              className="w-full h-10 px-3 py-2 text-sm rounded-md border border-input bg-background ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Timezone used for chart x-axis timestamps. Changes apply on next chart load.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
