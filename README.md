# Dose

A phone page for logging a morning, afternoon, or night dose.

The button records the time and subtracts half a pill. The amount can be changed before the tap when a dose is higher. The last recorded time sits under the button.

Each tap fills the next open space, in the order morning, afternoon, night. A night dose taken after midnight still goes in that night space. The clock only supplies the time written in the cell. Change period is for a correction.

Doses are stored in the Google Sheet named **Dose log copy**. The original Meds Audit Sheet is never read or written by this app. On the copy, change the first number in the pills formula when a bottle count does not match. Usual doses for each time of day are in K1:K3. A one-off higher dose is the amount above 0.5 in Morning extra, Afternoon extra, or Night extra.

Until that copy is connected, doses are saved with the signed-in account.
