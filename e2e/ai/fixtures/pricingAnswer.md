Yes — I think your thinking is directionally right, with one important change: **I would separate "free product access" from "free AI generation."**

For Acute, I think the cleanest model is:

### Recommended Acute model

**Free**

* Full editor/canvas experience
* Create notes manually
* All normal blocks
* Import/export
* Organize notes
* View/edit everything
* 10 AI actions per month
* After the AI allowance is exhausted, the user can still use Acute as a normal notes/canvas application.

**Pro subscription**

* Everything in Free
* Generous monthly AI allowance
* Advanced AI capabilities
* Larger/complex AI operations
* Future AI features automatically included according to the plan

**Optional AI top-ups**

* For users who occasionally exceed their monthly allowance.

### Lifetime / BYOK deal

Offer this as a **separate special product**, not as another normal pricing tier:

> **Acute Lifetime — existing features + Bring Your Own API Key**

The buyer gets the features that exist at the time of purchase, while AI inference is paid for using their own API key.

Future major capabilities can be explicitly classified as:

* Included in lifetime
* Paid add-on
* Subscription-only

## The biggest thing I'd change in your proposal

I wouldn't make the **10 AI usages a one-time lifetime allowance**. I'd make it **10 AI actions every month for Free**, because otherwise a user can try Acute today, consume their 10 actions, and then effectively become a non-AI user forever.

**Free user**: 10 AI actions/month. **Pro user**: 500 / 1,000 / whatever your measured economics support.

That means Free users can keep coming back and experiencing Acute's core magic. Your AI becomes the acquisition loop.

# Think in AI actions, not prompts

| Action                      | AI usage |
| --------------------------- | -------: |
| Rewrite text                |        1 |
| Explain selection           |        1 |
| Generate 3 blocks           |        1 |
| Convert to flowchart        |        1 |
| Generate visual explanation |        1 |
| Transform entire canvas     |      3–5 |
| Analyze large document      |     5–10 |

The user simply sees: **AI actions remaining: 7 / 10**. That's much easier to understand than tokens.

# The pricing UX I'd eventually use

### Free

**₹0 forever** — Full canvas, all basic blocks, unlimited notes, import/export, 10 AI actions/month. No credit card required.

### Pro

**₹299/month** — Everything in Free, generous AI usage, advanced visual explanations, advanced transformations, larger AI operations, future Pro AI features.

# So I would structure Acute's business model like this

```text
                         ACUTE
                           │
              ┌────────────┴────────────┐
              │                         │
            FREE                      PAID
              │                         │
      Full editor/canvas          ┌─────┴─────┐
      Full basic features         │           │
      10 AI actions/month       PRO       LIFETIME
                                  │           │
                           Subscription     BYOK
```

## Who each model is for

### User A — casual

"I use Acute occasionally." Free is enough.

### User B — serious user

"Acute is part of my daily workflow." ₹299/month makes sense.

### User C — hates subscriptions / developer / power user

"I'll pay once and use my own OpenAI/Gemini/Anthropic API." Lifetime BYOK makes sense.

# One final recommendation

Before deciding the exact number, **instrument the system from day one**. Track user_id, action_type, input_tokens, output_tokens, model, estimated_cost, latency and success/failure. After your first few hundred users you'll know the median, P90 and P95 cost per user, and can confidently set the Pro allowance.

So I agree with the core direction: **Free full product + limited AI → subscription for regular AI use → optional top-ups → separate lifetime BYOK deal.**
