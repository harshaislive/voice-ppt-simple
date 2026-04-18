# Conversion Features

## Context

Current architecture:
- Slides are loaded from CMS/Supabase at session start.
- A session-local slide set is created.
- Narration and audio are pre-generated for all slides in advance.

Implication:
- If we truly rewrite future slides after a user answers something, pre-generated future audio becomes stale.
- That means we must regenerate narration/audio, which adds latency.

So the product choice is not just "can we personalize?" but "at what layer do we personalize?"

## Feature 1: Questions Between Slides

### Product goal
Capture user intent while the deck is still in motion.

### Expected outcome
- Higher engagement
- Better clarity
- Better conversion because the user feels guided, not lectured

### Variants

#### 1. Adaptive framing only
What changes:
- Ask a between-slide question
- Save answer in session memory
- Use it for status copy, completion summary, CTA order, and Q&A tone

Speed impact:
- Fast
- Keeps current pre-generation model intact

Expected outcome:
- Strong lift in perceived personalization
- Low engineering risk

#### 2. Adaptive next-slide narration
What changes:
- Keep the visual slide from Supabase
- Regenerate only the next slide narration and audio based on the user answer

Speed impact:
- Medium
- Noticeable unless hidden carefully

Expected outcome:
- Much stronger feeling that the deck is responding live
- Good balance between personalization and speed

#### 3. Adaptive future slide rewriting
What changes:
- Rewrite future slide content after user input
- Regenerate narration/audio for those slides

Speed impact:
- Slowest
- Breaks the main advantage of full pre-generation

Expected outcome:
- Deep personalization
- Highest complexity and highest latency risk

## Recommended rollout

### Phase 1
Feature:
- Between-slide questions
- Session memory
- Adaptive completion summary
- Adaptive CTA ranking

Expected outcome:
- Better conversion without changing deck generation speed

### Phase 2
Feature:
- Regenerate narration/audio only for the next slide when user intent is clear

Expected outcome:
- Presentation feels live and personally guided
- Latency stays bounded to one slide at a time

### Phase 3
Feature:
- Branch decks in Supabase by intent path

Expected outcome:
- Real structural personalization
- Faster than on-the-fly rewriting if branches are pre-authored or pre-generated

## Best feature segmentation

### Feature: Between-slide intent capture
Expected outcome:
- Declared user interest early in the session

### Feature: Session memory
Expected outcome:
- Personalized summary, better CTA alignment, better Q&A relevance

### Feature: Adaptive next-slide narration
Expected outcome:
- User feels the deck is responding to them, not just storing their answers

### Feature: Adaptive CTA
Expected outcome:
- Higher action rate because the ask matches the path they took

### Feature: Supabase-backed branch paths
Expected outcome:
- Scalable personalization without runtime rewriting of the whole deck

## Recommendation

Do not start with full future-slide rewriting.

Start with:
1. Between-slide questions
2. Session memory
3. Adaptive completion + CTA
4. Then adaptive next-slide narration

This sequence gives the best conversion upside with the least latency cost.
