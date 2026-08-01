"""Scoring formulas for the three insurance-bet strategies.

All three operate on implied probability (p = 1 / decimal odds) of the
top four runners in a race by market rank, not raw odds — that keeps the
scores comparable across races regardless of price scale.

These are structural scores: how reliably each strategy's safety net
fires, based on the saved selection rules. Not a fully monetised dollar
EV (that would need stake caps and the cash-vs-bonus-bet conversion
factor per bookie layered on top).
"""


def implied_prob(decimal_odds):
    return 1 / decimal_odds


def neds_score(fav_odds, second_fav_odds, third_odds):
    """Favourite reliability x gap-to-third. Both factors must be strong —
    the refund only fires if the favourite wins AND the pick fills 2nd."""
    p_fav = implied_prob(fav_odds)
    p_2nd = implied_prob(second_fav_odds)
    p_3rd = implied_prob(third_odds)
    gap_ratio = (p_2nd - p_3rd) / p_2nd
    return p_fav * gap_ratio


def tabtouch_score(pick_odds, next_best_odds):
    """Pure gap-to-third. Favourite reliability is irrelevant here — pays
    on any 2nd regardless of who wins. Pick is normally the second fav."""
    p_pick = implied_prob(pick_odds)
    p_next = implied_prob(next_best_odds)
    return (p_pick - p_next) / p_pick


def stack_score(fav_odds, second_fav_odds, third_odds, fourth_odds):
    """Combined top-two dominance over depth at 3rd and 4th — a total
    loss needs two other runners to beat both legs."""
    p_top2 = implied_prob(fav_odds) + implied_prob(second_fav_odds)
    p_depth = implied_prob(third_odds) + implied_prob(fourth_odds)
    return p_top2 / p_depth


def score_race(odds_ranked):
    """odds_ranked: decimal win odds for at least the top 4 runners,
    sorted shortest to longest. Returns a dict of the three scores."""
    if len(odds_ranked) < 4:
        return None
    fav, second, third, fourth = odds_ranked[:4]
    return {
        "neds": round(neds_score(fav, second, third), 3),
        "tabtouch": round(tabtouch_score(second, third) * 100, 1),  # as %
        "stack": round(stack_score(fav, second, third, fourth), 2),
    }
