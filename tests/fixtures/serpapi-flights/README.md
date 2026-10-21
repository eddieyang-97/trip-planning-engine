# SerpApi representative shapes

These are handwritten, sanitized contract fixtures, not captured supplier responses or live acceptance. Dates, routes, flight identifiers, prices and tokens are deliberately fictional. No fixture constructs its echo from request parameters.

The field structure, omitted default type/cabin fields and numeric parameters follow [SerpApi's public Google Flights examples](https://serpapi.com/google-flights-api) and [flight-result schema](https://serpapi.com/google-flights-results), reviewed 21 October 2026. The return fixture represents the documented departure-token selection flow with explicit token binding; it is not evidence of which fields every live return response echoes. Four adults and GBP remain explicit because they differ from documented defaults. Missing stops are checked against every normalized itinerary.

Counterfactual tests remove the echoed token: only matching selected-flight evidence can supply alternative binding; absence of both fails closed. That optional selected-flight shape is defensive compatibility handling, not a claim that live return responses provide it. Mismatch/default tests distinguish intended acceptance policy from verified provider behavior. A separately approved live test is still required.
