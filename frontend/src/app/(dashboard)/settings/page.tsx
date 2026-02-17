"use client";

import { useState, useEffect } from "react";
import { useAuthStore } from "@/stores/auth-store";
import apiClient from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, CheckCircle2, XCircle, Eye, EyeOff, Send, Bell, Mail, MessageSquare, Smartphone } from "lucide-react";

interface BrokerStatus {
  connected: boolean;
  broker: string;
  api_key: string | null;
  token_expiry: string | null;
  token_valid: boolean;
  login_url: string | null;
}

interface NotificationSettings {
  telegram: { enabled: boolean; bot_token_set: boolean; chat_id: string | null };
  email: {
    enabled: boolean; smtp_host: string | null; smtp_port: number | null;
    smtp_username: string | null; smtp_password_set: boolean; smtp_use_tls: boolean;
    email_from: string | null; email_to: string | null;
  };
  sms: {
    enabled: boolean; twilio_account_sid: string | null;
    twilio_auth_token_set: boolean; twilio_from_number: string | null; sms_to_number: string | null;
  };
  event_channels: Record<string, string[]>;
}

const NOTIFICATION_EVENTS = [
  { category: "Critical", events: [
    { key: "order_filled", label: "Order Filled" },
    { key: "order_rejected", label: "Order Rejected" },
    { key: "stop_loss_triggered", label: "Stop-Loss Triggered" },
    { key: "session_crashed", label: "Session Crashed" },
    { key: "broker_disconnected", label: "Broker Disconnected" },
    { key: "max_drawdown_breached", label: "Max Drawdown Breached" },
  ]},
  { category: "Important", events: [
    { key: "session_started", label: "Session Started" },
    { key: "session_stopped", label: "Session Stopped" },
    { key: "position_opened", label: "Position Opened" },
    { key: "position_closed", label: "Position Closed" },
    { key: "daily_pnl_summary", label: "Daily P&L Summary" },
  ]},
  { category: "Info", events: [
    { key: "session_paused", label: "Session Paused" },
    { key: "session_resumed", label: "Session Resumed" },
    { key: "target_profit_reached", label: "Target Profit Reached" },
    { key: "no_trades_today", label: "No Trades Today" },
  ]},
];

const CHANNELS = ["telegram", "email", "sms"] as const;

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

  // Notification settings
  const [notifSettings, setNotifSettings] = useState<NotificationSettings | null>(null);
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpUseTls, setSmtpUseTls] = useState(true);
  const [emailFrom, setEmailFrom] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [twilioSid, setTwilioSid] = useState("");
  const [twilioAuthToken, setTwilioAuthToken] = useState("");
  const [twilioFromNum, setTwilioFromNum] = useState("");
  const [smsToNum, setSmsToNum] = useState("");
  const [eventChannels, setEventChannels] = useState<Record<string, string[]>>({});
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifMessage, setNotifMessage] = useState("");
  const [testingChannel, setTestingChannel] = useState<string | null>(null);
  const [showTgToken, setShowTgToken] = useState(false);
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [showTwilioToken, setShowTwilioToken] = useState(false);

  useEffect(() => {
    fetchBrokerStatus();
    fetchNotifSettings();
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

  const fetchNotifSettings = async () => {
    try {
      const res = await apiClient.get<NotificationSettings>("/notifications/settings");
      const s = res.data;
      setNotifSettings(s);
      setTgEnabled(s.telegram.enabled);
      setTgChatId(s.telegram.chat_id || "");
      setEmailEnabled(s.email.enabled);
      setSmtpHost(s.email.smtp_host || "");
      setSmtpPort(String(s.email.smtp_port || 587));
      setSmtpUsername(s.email.smtp_username || "");
      setSmtpUseTls(s.email.smtp_use_tls);
      setEmailFrom(s.email.email_from || "");
      setEmailTo(s.email.email_to || "");
      setSmsEnabled(s.sms.enabled);
      setTwilioSid(s.sms.twilio_account_sid || "");
      setTwilioFromNum(s.sms.twilio_from_number || "");
      setSmsToNum(s.sms.sms_to_number || "");
      setEventChannels(s.event_channels || {});
    } catch {
      // No settings yet
    }
  };

  const handleSaveNotifications = async () => {
    setNotifSaving(true);
    setNotifMessage("");
    try {
      const payload: any = {
        telegram: {
          enabled: tgEnabled,
          chat_id: tgChatId || null,
          ...(tgBotToken ? { bot_token: tgBotToken } : {}),
        },
        email: {
          enabled: emailEnabled,
          smtp_host: smtpHost || null,
          smtp_port: parseInt(smtpPort) || 587,
          smtp_username: smtpUsername || null,
          smtp_use_tls: smtpUseTls,
          email_from: emailFrom || null,
          email_to: emailTo || null,
          ...(smtpPassword ? { smtp_password: smtpPassword } : {}),
        },
        sms: {
          enabled: smsEnabled,
          twilio_account_sid: twilioSid || null,
          twilio_from_number: twilioFromNum || null,
          sms_to_number: smsToNum || null,
          ...(twilioAuthToken ? { twilio_auth_token: twilioAuthToken } : {}),
        },
        event_channels: eventChannels,
      };
      await apiClient.put("/notifications/settings", payload);
      setNotifMessage("Notification settings saved");
      setTgBotToken("");
      setSmtpPassword("");
      setTwilioAuthToken("");
      await fetchNotifSettings();
    } catch (err: any) {
      setNotifMessage(err.response?.data?.detail || "Failed to save notification settings");
    } finally {
      setNotifSaving(false);
    }
  };

  const handleTestNotification = async (channel: string) => {
    setTestingChannel(channel);
    try {
      await apiClient.post("/notifications/test", { channel });
      setNotifMessage(`Test ${channel} notification sent!`);
    } catch (err: any) {
      setNotifMessage(err.response?.data?.detail || `Test ${channel} failed`);
    } finally {
      setTestingChannel(null);
    }
  };

  const toggleEventChannel = (eventKey: string, channel: string) => {
    setEventChannels((prev) => {
      const current = prev[eventKey] || [];
      if (current.includes(channel)) {
        return { ...prev, [eventKey]: current.filter((c) => c !== channel) };
      }
      return { ...prev, [eventKey]: [...current, channel] };
    });
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

      {/* Telegram Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" /> Telegram Notifications
          </CardTitle>
          <CardDescription>Receive alerts via Telegram bot</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={tgEnabled}
              onChange={(e) => setTgEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <span className="text-sm font-medium">Enable Telegram</span>
          </label>
          {tgEnabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="tgBotToken">Bot Token</Label>
                <div className="relative">
                  <Input
                    id="tgBotToken"
                    type={showTgToken ? "text" : "password"}
                    value={tgBotToken}
                    onChange={(e) => setTgBotToken(e.target.value)}
                    placeholder={notifSettings?.telegram.bot_token_set ? "Token saved (leave blank to keep)" : "Your Telegram bot token"}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTgToken(!showTgToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showTgToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tgChatId">Chat ID</Label>
                <Input
                  id="tgChatId"
                  value={tgChatId}
                  onChange={(e) => setTgChatId(e.target.value)}
                  placeholder="Your Telegram chat ID"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSaveNotifications} disabled={notifSaving} size="sm">
                  {notifSaving ? "Saving..." : "Save"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTestNotification("telegram")}
                  disabled={testingChannel === "telegram"}
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  {testingChannel === "telegram" ? "Sending..." : "Send Test"}
                </Button>
              </div>
            </>
          )}
          {notifMessage && !tgEnabled && (
            <p className="text-sm text-muted-foreground">{notifMessage}</p>
          )}
        </CardContent>
      </Card>

      {/* Email Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Email Notifications
          </CardTitle>
          <CardDescription>Receive alerts via email (SMTP)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={emailEnabled}
              onChange={(e) => setEmailEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <span className="text-sm font-medium">Enable Email</span>
          </label>
          {emailEnabled && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="smtpHost">SMTP Host</Label>
                  <Input id="smtpHost" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtpPort">Port</Label>
                  <Input id="smtpPort" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="smtpUsername">Username</Label>
                  <Input id="smtpUsername" value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} placeholder="your@email.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtpPassword">Password</Label>
                  <div className="relative">
                    <Input
                      id="smtpPassword"
                      type={showSmtpPass ? "text" : "password"}
                      value={smtpPassword}
                      onChange={(e) => setSmtpPassword(e.target.value)}
                      placeholder={notifSettings?.email.smtp_password_set ? "Saved (leave blank to keep)" : "App password"}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSmtpPass(!showSmtpPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showSmtpPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={smtpUseTls} onChange={(e) => setSmtpUseTls(e.target.checked)} className="h-4 w-4 rounded border-input" />
                <span className="text-sm">Use TLS</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="emailFrom">From Address</Label>
                  <Input id="emailFrom" value={emailFrom} onChange={(e) => setEmailFrom(e.target.value)} placeholder="alerts@yourdomain.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emailTo">To Address</Label>
                  <Input id="emailTo" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="you@email.com" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSaveNotifications} disabled={notifSaving} size="sm">
                  {notifSaving ? "Saving..." : "Save"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTestNotification("email")}
                  disabled={testingChannel === "email"}
                >
                  <Mail className="h-3.5 w-3.5 mr-1.5" />
                  {testingChannel === "email" ? "Sending..." : "Send Test"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* SMS Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" /> SMS Notifications
          </CardTitle>
          <CardDescription>Receive alerts via SMS (Twilio)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={smsEnabled}
              onChange={(e) => setSmsEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <span className="text-sm font-medium">Enable SMS</span>
          </label>
          {smsEnabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="twilioSid">Twilio Account SID</Label>
                <Input id="twilioSid" value={twilioSid} onChange={(e) => setTwilioSid(e.target.value)} placeholder="ACxxxxxxxxxx" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="twilioAuthToken">Auth Token</Label>
                <div className="relative">
                  <Input
                    id="twilioAuthToken"
                    type={showTwilioToken ? "text" : "password"}
                    value={twilioAuthToken}
                    onChange={(e) => setTwilioAuthToken(e.target.value)}
                    placeholder={notifSettings?.sms.twilio_auth_token_set ? "Saved (leave blank to keep)" : "Twilio auth token"}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTwilioToken(!showTwilioToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showTwilioToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="twilioFromNum">From Number</Label>
                  <Input id="twilioFromNum" value={twilioFromNum} onChange={(e) => setTwilioFromNum(e.target.value)} placeholder="+1234567890" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smsToNum">To Number</Label>
                  <Input id="smsToNum" value={smsToNum} onChange={(e) => setSmsToNum(e.target.value)} placeholder="+91xxxxxxxxxx" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSaveNotifications} disabled={notifSaving} size="sm">
                  {notifSaving ? "Saving..." : "Save"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTestNotification("sms")}
                  disabled={testingChannel === "sms"}
                >
                  <Smartphone className="h-3.5 w-3.5 mr-1.5" />
                  {testingChannel === "sms" ? "Sending..." : "Send Test"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Notification Events */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" /> Notification Events
          </CardTitle>
          <CardDescription>Choose which events trigger notifications on each channel</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {NOTIFICATION_EVENTS.map((group) => (
            <div key={group.category}>
              <h4 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">
                {group.category}
              </h4>
              <div className="space-y-1">
                {/* Header row */}
                <div className="grid grid-cols-[1fr_60px_60px_60px] gap-2 text-xs text-muted-foreground font-medium pb-1">
                  <span>Event</span>
                  <span className="text-center">TG</span>
                  <span className="text-center">Email</span>
                  <span className="text-center">SMS</span>
                </div>
                {group.events.map((evt) => (
                  <div key={evt.key} className="grid grid-cols-[1fr_60px_60px_60px] gap-2 items-center py-1 border-t border-border/50">
                    <span className="text-sm">{evt.label}</span>
                    {CHANNELS.map((ch) => (
                      <div key={ch} className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={(eventChannels[evt.key] || []).includes(ch)}
                          onChange={() => toggleEventChannel(evt.key, ch)}
                          className="h-4 w-4 rounded border-input cursor-pointer"
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {notifMessage && (
            <p className="text-sm text-muted-foreground">{notifMessage}</p>
          )}

          <Button onClick={handleSaveNotifications} disabled={notifSaving} className="w-full">
            {notifSaving ? "Saving..." : "Save All Notification Settings"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
