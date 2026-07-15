async function test() {
  try {
    const loginRes = await fetch('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '8630801380',
        password: 'ColdBeast@123'
      })
    });
    const loginData = await loginRes.json();
    console.log("Login response:", JSON.stringify(loginData, null, 2));
    
    if (!loginData.data || !loginData.data.token) {
      console.log("No access token!");
      return;
    }
    const token = loginData.data.token;

    const res = await fetch('http://localhost:3000/api/v1/customers/phone/9412944335', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    
    console.log("Customer response:", JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error("Error:", err.message);
  }
}

test();
