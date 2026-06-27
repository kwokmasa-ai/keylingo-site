# KeyLingo — Developer Integration Guide

## PRIORITY: TestFlight Setup

We need a TestFlight build ASAP so we can start real-world testing and creating content.

### Steps:
1. In Xcode: **Product → Archive** the app
2. Upload to **App Store Connect** (Xcode → Distribute App → App Store Connect)
3. In App Store Connect, go to the **TestFlight** tab
4. Add internal tester: **Keylingo@proton.me**
5. The tester will get an email invite to install via TestFlight

### What we'll test:
- Keyboard appears in Settings → General → Keyboards
- Language switching works in real conversations
- Translation accuracy across language pairs
- "Allow Full Access" flow is clear to the user
- Paywall triggers correctly (after free limit reached)
- Subscription purchase flow (sandbox)
- Restore purchases works
- App doesn't crash or lag during normal use

### Timeline:
- Need first TestFlight build by **Friday June 27** if possible
- Final build with RevenueCat by **Saturday June 28**
- App Store submission **Sunday June 29**

---

## RevenueCat SDK Integration

### 1. Install RevenueCat SDK

Add to your `Podfile`:
```ruby
pod 'RevenueCat'
```

Or via Swift Package Manager:
```
https://github.com/RevenueCat/purchases-ios.git
```

### 2. Configure in AppDelegate / App entry point

```swift
import RevenueCat

// In didFinishLaunchingWithOptions or App init:
Purchases.logLevel = .debug  // Remove in production
Purchases.configure(withAPIKey: "YOUR_REVENUECAT_API_KEY")
```

### 3. Entitlements setup

We're using one entitlement called **"premium"** with two products:
- `keylingo_monthly` — Monthly subscription
- `keylingo_yearly` — Yearly subscription

### 4. Check subscription status

```swift
func checkPremiumAccess() async -> Bool {
    let customerInfo = try? await Purchases.shared.customerInfo()
    return customerInfo?.entitlements["premium"]?.isActive == true
}
```

### 5. Show paywall

```swift
import RevenueCat

func showPaywall() async {
    let offerings = try? await Purchases.shared.offerings()
    guard let current = offerings?.current else { return }
    // Display current.availablePackages to the user
    // current.monthly — monthly package
    // current.annual — annual package
}
```

### 6. Make a purchase

```swift
func purchase(package: Package) async {
    do {
        let result = try await Purchases.shared.purchase(package: package)
        if result.customerInfo.entitlements["premium"]?.isActive == true {
            // Unlock premium features
            unlockPremium()
        }
    } catch {
        // Handle error
    }
}
```

### 7. Restore purchases

```swift
func restorePurchases() async {
    let customerInfo = try? await Purchases.shared.restorePurchases()
    if customerInfo?.entitlements["premium"]?.isActive == true {
        unlockPremium()
    }
}
```

### 8. What to gate behind premium

**Free features:**
- Basic keyboard with 5 languages
- Limited translations per day (e.g., 10)
- Standard word suggestions

**Premium features (behind paywall):**
- All 100+ languages unlocked
- Unlimited translations
- Priority translation speed
- No ads
- Custom keyboard themes (future)

### 9. Paywall screen requirements

The paywall screen MUST include (Apple requirement):
- Subscription price and duration clearly displayed
- Free trial duration if applicable (e.g., "7-day free trial")
- "Payment will be charged to your Apple ID account at confirmation of purchase"
- "Subscription automatically renews unless canceled at least 24 hours before the end of the current period"
- Link to Terms of Service: https://kwokmasa-ai.github.io/keylingo-site/terms.html
- Link to Privacy Policy: https://kwokmasa-ai.github.io/keylingo-site/privacy.html
- "Restore Purchases" button

### 10. Keyboard extension notes

- The keyboard extension runs in a separate process with limited memory (~30MB)
- Network requests for translation need "Allow Full Access" enabled
- Use App Groups to share data between the main app and keyboard extension
- Test on a real device — the simulator doesn't accurately reflect keyboard extension behavior

### 11. Webhook (already set up)

Our dashboard has a RevenueCat webhook endpoint ready at:
```
POST /webhooks/revenuecat
```
This will be configured in RevenueCat dashboard once we have a public server URL.
Events handled: INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, SUBSCRIBER_ALIAS

### 12. Testing

- Use RevenueCat sandbox mode for testing purchases
- Apple sandbox test accounts: create in App Store Connect → Users and Access → Sandbox
- Test flows: install → enable keyboard → type → hit free limit → see paywall → purchase → unlock
- Test restore purchases flow
- Test cancellation and expiration behavior
